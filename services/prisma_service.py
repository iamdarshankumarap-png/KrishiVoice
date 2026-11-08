import os
import subprocess
import tempfile
import imageio_ffmpeg

from gnani.stt import GnaniSTTClient
from config import GNANI_API_KEY

client = GnaniSTTClient(api_key=GNANI_API_KEY)


def transcribe_audio(audio_file, language):

    language_settings = {
        "en": ("en-IN", "transcribe"),
        "kn": ("kn-IN", "transcribe"),
        "hinglish": ("hi-IN", "codemix")
    }

    language_code, output_format = language_settings.get(
        language, ("en-IN", "transcribe")
    )

    with tempfile.TemporaryDirectory() as temp_dir:

        input_path = os.path.join(temp_dir, "recording.webm")
        output_path = os.path.join(temp_dir, "recording.wav")

        audio_file.save(input_path)

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

        subprocess.run(
            [
                ffmpeg, "-y", "-i", input_path,
                "-ar", "16000", "-ac", "1", output_path
            ],
            check=True,
            capture_output=True
        )

        result = client.transcribe(
            output_path,
            language_code=language_code,
            model="prisma-v3.0",
            format=output_format
        )

        return result