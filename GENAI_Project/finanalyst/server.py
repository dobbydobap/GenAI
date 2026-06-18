from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from finanalyst.analyzer import analyze_batch, analyze_document
from finanalyst.config import load_env_file

load_env_file()

app = FastAPI(title="Financial Document Analyst")

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
SAMPLE = ROOT / "data" / "uploads" / "0000936468-21-000013.pdf"

# Serve static files
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

@app.get("/")
async def root():
    return FileResponse(STATIC / "index.html")

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.get("/api/sample")
async def sample():
    if not SAMPLE.exists():
        raise HTTPException(status_code=404, detail="Sample file not found")
    result = analyze_document(SAMPLE)
    return JSONResponse(content=result)

@app.post("/api/analyze")
async def analyze(documents: list[UploadFile] = File(...)):
    if not documents:
        raise HTTPException(status_code=400, detail="Upload at least one PDF or transcript.")

    # Securely process files in a temporary directory to avoid ephemeral disk buildup
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        saved_files = []
        
        for upload in documents:
            filename = upload.filename or "uploaded_file"
            name = Path(filename).name
            target = temp_path / f"{uuid.uuid4().hex[:10]}-{name}"
            
            content = await upload.read()
            target.write_bytes(content)
            saved_files.append(target)
            
        if not saved_files:
            raise HTTPException(status_code=400, detail="No valid files provided")
            
        prior = None
        if len(saved_files) == 1:
            result = analyze_document(saved_files[0])
        else:
            result = analyze_batch(saved_files)
            for document in result.get("documents", []):
                if prior:
                    doc_path = next((f for f in saved_files if f.name == document["filename"]), None)
                    if doc_path:
                        refreshed = analyze_document(doc_path, prior)
                        document.update(refreshed)
                prior = document
                
        return JSONResponse(content=result)

if __name__ == "__main__":
    import uvicorn
    
    query = parse_qs(urlparse("?" + " ".join(sys.argv[1:])).query)
    port = int(query.get("port", ["8000"])[0]) if query else 8000
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
        
    print(f"Financial Document Analyst running at http://127.0.0.1:{port}")
    uvicorn.run("finanalyst.server:app", host="127.0.0.1", port=port, reload=False)
