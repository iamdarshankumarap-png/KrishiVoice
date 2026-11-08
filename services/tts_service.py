
from gnani.tts import GnaniTTSClient, AudioConfig
from config import GNANI_API_KEY

# Initialize Gnani Timbre client
client = GnaniTTSClient(api_key=GNANI_API_KEY)


def generate_speech(text, language="en"):

    language_settings = {
        "en": "en-IN",
        "kn": "kn-IN",
        "hinglish": "hi-IN"
    }

    selected_language = language_settings.get(language, "en-IN")

    # Generate speech using Timbre v2.5
    audio = client.synthesize(
        text,
        voice="Kaveri",
        model="timbre-v2.5",
        language=selected_language,
        speed=1.0,
        audio_config=AudioConfig(
            container="mp3",
            sample_rate=44100,
            bitrate="128k"
        )
    )

    return audio
