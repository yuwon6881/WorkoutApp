from pypdf import PdfReader
import sys
sys.stdout.reconfigure(encoding="utf-8")

path = r"C:\Users\User\Downloads\The_Min-Max_Phase2_Program__5X.pdf.pdf"
reader = PdfReader(path)
print("pages", len(reader.pages))
for index, page in enumerate(reader.pages):
    text = page.extract_text() or ""
    print(f"---PAGE {index + 1}---")
    print(text[:6000])
