
from google import genai
from config import GEMINI_API_KEY
from PIL import Image

client = genai.Client(
    api_key=GEMINI_API_KEY,
    http_options=genai.types.HttpOptions(timeout=60000),
)
AI_MODEL = "gemini-3.5-flash-lite"
GENERATION_CONFIG = genai.types.GenerateContentConfig(
    max_output_tokens=350,
    temperature=0.3,
)

SYSTEM_PROMPT = """
You are KrishiVoice, a helpful AI farming assistant for Indian farmers.

Reply in the requested language (English, Kannada, or Hinglish) using simple, friendly,
practical language. Keep advice concise: use 3-5 short sentences or bullets. Ask one
focused follow-up question if essential context is missing. Never invent pesticide or
fertilizer dosages or recommend dangerous chemical combinations. For serious or uncertain
problems, recommend a local KVK or agriculture officer.
"""


def _farming_prompt(question, language, crop, location):
    language_names = {
        "en": "English",
        "kn": "Kannada",
        "hinglish": "Hinglish"
    }

    return f"""
{SYSTEM_PROMPT}

Respond in {language_names.get(language, "English")}.
Farmer's question: {question}
Crop: {crop or "Not provided"}
Location: {location or "Not provided"}
"""


def get_farming_response(question, language="en", crop="", location=""):
    response = client.models.generate_content(
        model=AI_MODEL,
        contents=_farming_prompt(question, language, crop, location),
        config=GENERATION_CONFIG,
    )

    return response.text


def stream_farming_response(question, language="en", crop="", location=""):
    response_stream = client.models.generate_content_stream(
        model=AI_MODEL,
        contents=_farming_prompt(question, language, crop, location),
        config=GENERATION_CONFIG,
    )
    for chunk in response_stream:
        if chunk.text:
            yield chunk.text


def _image_prompt(language, crop, location):
    language_names = {
        "en": "English",
        "kn": "Kannada",
        "hinglish": "Hinglish"
    }

    return f"""
{SYSTEM_PROMPT}

Analyze the crop photo and respond in {language_names.get(language, "English")}. Briefly
identify the plant if possible, describe visible symptoms, suggest safe next steps, and
mention what context could help confirm the cause. Do not claim a definite diagnosis from
an image alone.
Farmer-reported crop: {crop or "Not provided"}
Farmer's location: {location or "Not provided"}
"""
def analyze_crop_image(image_file, language="en", crop="", location=""):
    image = Image.open(image_file).convert("RGB")

    response = client.models.generate_content(
        model=AI_MODEL,
        contents=[_image_prompt(language, crop, location), image],
        config=GENERATION_CONFIG,
    )

    return response.text


def stream_crop_image_analysis(image_file, language="en", crop="", location=""):
    with Image.open(image_file) as source:
        image = source.convert("RGB")

    def generate():
        try:
            response_stream = client.models.generate_content_stream(
                model=AI_MODEL,
                contents=[_image_prompt(language, crop, location), image],
                config=GENERATION_CONFIG,
            )
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
        finally:
            image.close()

    return generate()
