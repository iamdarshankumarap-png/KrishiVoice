from services.ai_service import get_farming_response

answer = get_farming_response(
    "My tomato plants have yellow leaves. What should I do?",
    "en"
)

print("\nKrishiVoice Answer:\n")
print(answer)