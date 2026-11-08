
import requests
from flask import Flask, Response, render_template, request, jsonify, send_file, stream_with_context
from PIL import Image, UnidentifiedImageError
import io
import json
import os

from services.ai_service import (
    get_farming_response,
    analyze_crop_image,
    stream_farming_response,
    stream_crop_image_analysis,
)
from services.prisma_service import transcribe_audio
from services.tts_service import generate_speech

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
app.config["TEMPLATES_AUTO_RELOAD"] = True

SUPPORTED_LANGUAGES = {"en", "kn", "hinglish"}
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_PIXELS = 20_000_000


def validate_language(value):
    if not isinstance(value, str) or value not in SUPPORTED_LANGUAGES:
        raise ValueError("Please choose a supported language.")
    return value


def text_field(data, name):
    value = data.get(name, "")
    if not isinstance(value, str):
        raise ValueError(f"{name.capitalize()} must be text.")
    return value.strip()


def validate_image(image_file):
    if not image_file or not image_file.filename:
        raise ValueError("Please select a crop image.")

    extension = os.path.splitext(image_file.filename)[1].lower()
    if extension not in SUPPORTED_IMAGE_EXTENSIONS:
        raise ValueError("Use a JPG, PNG, or WebP image.")

    try:
        image_file.stream.seek(0)
        with Image.open(image_file.stream) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Use a JPG, PNG, or WebP image.")
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("Image is too large to analyze. Choose a smaller image.")
            image.verify()
        image_file.stream.seek(0)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ValueError("The selected file is not a valid image.")


def stream_text_response(text_stream, error_message):
    def generate():
        try:
            for text in text_stream:
                yield f"data: {json.dumps({'text': text}, ensure_ascii=False)}\n\n"
            yield 'data: {"done": true}\n\n'
        except Exception:
            app.logger.exception("Streaming AI response error")
            yield f"data: {json.dumps({'error': error_message})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


# Home page
@app.route("/")
def home():
    return render_template("index.html")


# Gnani Prisma: Speech-to-Text
@app.route("/api/transcribe", methods=["POST"])
def transcribe():

    if "audio" not in request.files:
        return jsonify({"error": "No audio file received"}), 400

    audio_file = request.files["audio"]

    try:
        language = validate_language(request.form.get("language", "en"))
        audio_file.stream.seek(0, os.SEEK_END)
        audio_size = audio_file.stream.tell()
        audio_file.stream.seek(0)
        if not audio_file.filename or audio_size == 0:
            return jsonify({"error": "Please record audio before submitting."}), 400
        result = transcribe_audio(audio_file, language)

        return jsonify({
            "success": True,
            "transcript": result.get("transcript", ""),
            "detected_language": result.get("detected_language_code")
        })

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except requests.exceptions.RequestException as error:
        return jsonify({
            "error": f"Gnani API error: {error}"
        }), 502

    except Exception:
        app.logger.exception("Transcription error")

        return jsonify({
            "error": "Transcription failed. Please try again."
        }), 500


# Gemini: AI Farming Answer
@app.route("/api/ask", methods=["POST"])
def ask():

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Please send your question as a JSON object."}), 400
    try:
        question = text_field(data, "question")
        crop = text_field(data, "crop")
        location = text_field(data, "location")
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if not question:
        return jsonify({
            "error": "Please enter a question."
        }), 400
    if len(question) > 2000:
        return jsonify({"error": "Keep your question under 2,000 characters."}), 400
    if len(crop) > 100 or len(location) > 100:
        return jsonify({"error": "Crop and location details must be under 100 characters."}), 400

    try:
        language = validate_language(data.get("language", "en"))
        answer = get_farming_response(question, language, crop=crop, location=location)

        return jsonify({
            "success": True,
            "answer": answer
        })

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("AI response error")

        return jsonify({
            "error": "Could not generate an answer. Please try again."
        }), 502


@app.route("/api/ask/stream", methods=["POST"])
def ask_stream():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Please send your question as a JSON object."}), 400
    try:
        question = text_field(data, "question")
        crop = text_field(data, "crop")
        location = text_field(data, "location")
        language = validate_language(data.get("language", "en"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if not question:
        return jsonify({"error": "Please enter a question."}), 400
    if len(question) > 2000:
        return jsonify({"error": "Keep your question under 2,000 characters."}), 400
    if len(crop) > 100 or len(location) > 100:
        return jsonify({"error": "Crop and location details must be under 100 characters."}), 400

    return stream_text_response(
        stream_farming_response(question, language, crop=crop, location=location),
        "Could not generate an answer. Please try again.",
    )


@app.route("/api/speak", methods=["POST"])
def speak():

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "Please send text as a JSON object."}), 400
    try:
        text = text_field(data, "text")
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if not text:
        return jsonify({"error": "No text provided"}), 400
    if len(text) > 3000:
        return jsonify({"error": "Text is too long to read aloud."}), 400

    try:
        language = validate_language(data.get("language", "en"))
        audio = generate_speech(text, language)

        return send_file(
            io.BytesIO(audio),
            mimetype="audio/mpeg",
            as_attachment=False,
            download_name="krishivoice.mp3"
        )

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Speech generation error")
        return jsonify({"error": "Speech generation failed"}), 502


# Gemini: Crop Image Analysis
@app.route("/api/analyze-image", methods=["POST"])
def analyze_image():

    if "image" not in request.files:
        return jsonify({"error": "No crop image received"}), 400

    image_file = request.files["image"]
    crop = (request.form.get("crop") or "").strip()
    location = (request.form.get("location") or "").strip()
    if len(crop) > 100 or len(location) > 100:
        return jsonify({"error": "Crop and location details must be under 100 characters."}), 400

    try:
        language = validate_language(request.form.get("language", "en"))
        validate_image(image_file)
        result = analyze_crop_image(image_file, language, crop=crop, location=location)

        return jsonify({
            "success": True,
            "analysis": result
        })

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Crop image analysis error")

        return jsonify({
            "error": "Could not analyze the crop image."
        }), 502


@app.route("/api/analyze-image/stream", methods=["POST"])
def analyze_image_stream():
    if "image" not in request.files:
        return jsonify({"error": "No crop image received"}), 400

    image_file = request.files["image"]
    try:
        crop = text_field(request.form, "crop")
        location = text_field(request.form, "location")
        language = validate_language(request.form.get("language", "en"))
        if len(crop) > 100 or len(location) > 100:
            return jsonify({"error": "Crop and location details must be under 100 characters."}), 400
        validate_image(image_file)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    return stream_text_response(
        stream_crop_image_analysis(image_file, language, crop=crop, location=location),
        "Could not analyze the crop image. Please try again.",
    )


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "File is too large. Maximum upload size is 10 MB."}), 413


if __name__ == "__main__":
    app.run()
