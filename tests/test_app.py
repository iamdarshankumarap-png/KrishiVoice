import io
import os
import unittest
from unittest.mock import patch

os.environ.setdefault("GNANI_API_KEY", "test-key")
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from PIL import Image

import app as flask_app
from services import ai_service


def crop_image_bytes(image_format, color=(83, 142, 71)):
    image = Image.new("RGB", (96, 72), color=color)
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    buffer.seek(0)
    return buffer


class KrishiVoiceAppTests(unittest.TestCase):
    def setUp(self):
        flask_app.app.config.update(TESTING=True, MAX_CONTENT_LENGTH=10 * 1024 * 1024)
        self.client = flask_app.app.test_client()

    def test_home_page_contains_farmer_and_crop_fields(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="location"', response.data)
        self.assertIn(b'id="crop"', response.data)
        self.assertIn(b'id="cropImage"', response.data)
        self.assertIn(b'id="chooseImageButton"', response.data)
        self.assertIn(b'id="listenButton"', response.data)
        self.assertIn(b'app.js?v=14', response.data)

    def test_question_requires_text_and_rejects_non_string_values(self):
        for payload in ({}, {"question": ["not", "text"]}, {"question": " " * 3}):
            with self.subTest(payload=payload):
                response = self.client.post("/api/ask", json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.get_json())

    @patch("app.get_farming_response", return_value="Check soil moisture first.")
    def test_question_includes_farmer_crop_and_location(self, mock_response):
        response = self.client.post(
            "/api/ask",
            json={
                "question": "Why are my leaves yellow?",
                "language": "en",
                "crop": "Tomato",
                "location": "Mysuru",
            },
        )
        self.assertEqual(response.status_code, 200)
        mock_response.assert_called_once_with(
            "Why are my leaves yellow?", "en", crop="Tomato", location="Mysuru"
        )

    def test_question_stream_returns_incremental_text_and_completion(self):
        with patch(
            "app.stream_farming_response",
            return_value=iter(["Check the soil ", "before watering."]),
        ) as stream:
            response = self.client.post(
                "/api/ask/stream",
                json={
                    "question": "Why are my leaves yellow?",
                    "crop": "Tomato",
                    "location": "Mysuru",
                },
            )

        body = response.get_data(as_text=True)
        self.assertEqual(response.mimetype, "text/event-stream")
        self.assertIn('"text": "Check the soil "', body)
        self.assertIn('"text": "before watering."', body)
        self.assertIn('"done": true', body)
        stream.assert_called_once_with(
            "Why are my leaves yellow?", "en", crop="Tomato", location="Mysuru"
        )

    def test_question_stream_reports_provider_errors(self):
        def failed_stream():
            raise RuntimeError("provider unavailable")
            yield "unreachable"

        with patch("app.stream_farming_response", return_value=failed_stream()):
            response = self.client.post(
                "/api/ask/stream",
                json={"question": "How often should I water rice?"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("Could not generate an answer", response.get_data(as_text=True))

    def test_microphone_audio_is_transcribed(self):
        with patch(
            "app.transcribe_audio",
            return_value={"transcript": "My tomato leaves are yellow", "detected_language_code": "en-IN"},
        ) as transcribe:
            response = self.client.post(
                "/api/transcribe",
                data={"audio": (io.BytesIO(b"recorded audio"), "recording.webm"), "language": "en"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["transcript"], "My tomato leaves are yellow")
        transcribe.assert_called_once()

    def test_microphone_transcription_rejects_empty_audio_and_invalid_language(self):
        with patch("app.transcribe_audio") as transcribe:
            empty_audio = self.client.post(
                "/api/transcribe",
                data={"audio": (io.BytesIO(b""), "recording.webm"), "language": "en"},
            )
            invalid_language = self.client.post(
                "/api/transcribe",
                data={"audio": (io.BytesIO(b"audio"), "recording.webm"), "language": "unsupported"},
            )

        self.assertEqual(empty_audio.status_code, 400)
        self.assertEqual(invalid_language.status_code, 400)
        transcribe.assert_not_called()

    def test_audio_response_returns_playable_mpeg(self):
        with patch("app.generate_speech", return_value=b"fake mp3 audio") as synthesize:
            response = self.client.post(
                "/api/speak",
                json={"text": "Check the soil moisture.", "language": "en"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "audio/mpeg")
        self.assertEqual(response.data, b"fake mp3 audio")
        synthesize.assert_called_once_with("Check the soil moisture.", "en")

    def test_sample_crop_images_upload_as_jpeg_png_and_webp(self):
        samples = (
            ("JPEG", "tomato.jpg", (190, 75, 58)),
            ("PNG", "rice.png", (122, 160, 82)),
            ("WEBP", "cotton.webp", (196, 184, 132)),
        )
        with patch("app.analyze_crop_image", return_value="Image reviewed.") as analyze:
            for image_format, filename, color in samples:
                with self.subTest(image_format=image_format):
                    response = self.client.post(
                        "/api/analyze-image",
                        data={
                            "image": (crop_image_bytes(image_format, color), filename),
                            "language": "kn",
                            "crop": filename.split(".")[0],
                            "location": "Mysuru",
                        },
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.get_json()["analysis"], "Image reviewed.")

        self.assertEqual(analyze.call_count, len(samples))
        for call, (_, filename, _) in zip(analyze.call_args_list, samples):
            self.assertEqual(call.args[1], "kn")
            self.assertEqual(call.kwargs["crop"], filename.split(".")[0])
            self.assertEqual(call.kwargs["location"], "Mysuru")

    def test_crop_image_stream_returns_incremental_analysis(self):
        with patch(
            "app.stream_crop_image_analysis",
            return_value=iter(["The leaves show ", "possible stress."]),
        ) as stream:
            response = self.client.post(
                "/api/analyze-image/stream",
                data={
                    "image": (crop_image_bytes("JPEG"), "tomato.jpg"),
                    "crop": "Tomato",
                    "location": "Mysuru",
                },
            )

        body = response.get_data(as_text=True)
        self.assertEqual(response.mimetype, "text/event-stream")
        self.assertIn('"text": "The leaves show "', body)
        self.assertIn('"text": "possible stress."', body)
        self.assertIn('"done": true', body)
        stream.assert_called_once()

    def test_crop_image_stream_keeps_image_open_after_request_file_closes(self):
        image_file = crop_image_bytes("JPEG")
        with patch.object(
            ai_service.client.models,
            "generate_content_stream",
            return_value=iter([type("Chunk", (), {"text": "Possible leaf stress."})()]),
        ) as generate:
            stream = ai_service.stream_crop_image_analysis(image_file, crop="Tomato")
            image_file.close()
            self.assertEqual(list(stream), ["Possible leaf stress."])

        image = generate.call_args.kwargs["contents"][1]
        self.assertEqual(image.size, (96, 72))
        with self.assertRaises(ValueError):
            image.getpixel((0, 0))

    def test_image_analysis_rejects_missing_unsupported_and_invalid_images(self):
        with patch("app.analyze_crop_image") as analyze:
            missing = self.client.post("/api/analyze-image", data={})
            unsupported = self.client.post(
                "/api/analyze-image",
                data={"image": (io.BytesIO(b"not an image"), "crop.gif")},
            )
            invalid = self.client.post(
                "/api/analyze-image",
                data={"image": (io.BytesIO(b"not an image"), "crop.jpg")},
            )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(unsupported.status_code, 400)
        self.assertEqual(invalid.status_code, 400)
        analyze.assert_not_called()

    def test_image_analysis_rejects_excessive_dimensions(self):
        image = Image.new("RGB", (5000, 5000), color=(83, 142, 71))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        image_bytes = buffer.getvalue()
        with patch("app.analyze_crop_image") as analyze:
            response = self.client.post(
                "/api/analyze-image",
                data={"image": (io.BytesIO(image_bytes), "oversized.png")},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.get_json()["error"])
        analyze.assert_not_called()

    def test_request_size_limit_returns_json_error(self):
        flask_app.app.config["MAX_CONTENT_LENGTH"] = 100
        response = self.client.post(
            "/api/analyze-image",
            data={"image": (io.BytesIO(b"x" * 200), "crop.jpg")},
        )
        self.assertEqual(response.status_code, 413)
        self.assertIn("10 MB", response.get_json()["error"])

    def test_invalid_language_and_oversized_question_are_rejected(self):
        invalid_language = self.client.post(
            "/api/ask", json={"question": "Help", "language": "unsupported"}
        )
        oversized_question = self.client.post(
            "/api/ask", json={"question": "x" * 2001}
        )
        self.assertEqual(invalid_language.status_code, 400)
        self.assertEqual(oversized_question.status_code, 400)


if __name__ == "__main__":
    unittest.main()
