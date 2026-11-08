
import os
from dotenv import load_dotenv

load_dotenv()

GNANI_API_KEY = os.getenv("GNANI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GNANI_API_KEY:
    raise ValueError("Gnani API key not found.")

if not GEMINI_API_KEY:
    raise ValueError("Gemini API key not found.")
