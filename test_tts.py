
from services.tts_service import generate_speech

text = "Namaste! Welcome to KrishiVoice. How can I help you with farming today?"

print("Generating speech using Gnani Timbre...")

audio = generate_speech(text, "en")

with open("test_voice.mp3", "wb") as file:
    file.write(audio)

print("Success! Audio saved as test_voice.mp3")
