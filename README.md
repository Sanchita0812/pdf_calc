# Bank Statement Expense Calculator

A web application to extract, preview, filter, and calculate transaction statistics (Total, Count, Average, Min, Max) from digital bank statement PDFs and statement images.

## Features
- **Smart Column Detection**: Heuristically detects which columns contain dates and which contain transaction amounts.
- **Support for Password-Protected PDFs**: Promptly requests passwords when locked PDFs are uploaded.
- **OCR Support**: Performs Optical Character Recognition (OCR) on image statements (PNG, JPG, JPEG) using Tesseract.
- **Memory Optimized for Large PDFs**: Employs in-memory buffering and page-by-page garbage collection to parse 70+ page statements without crashing servers on limited RAM.
- **Flexible Date & Column Filtering**: Allows custom date boundary filters and amount column selections.
- **Indian Currency Formatting**: Formats calculated outputs using the Indian numbering system (e.g. `₹12,34,567.89`).
- **Export Capabilities**: Allows downloading filtered statements directly as CSV or Excel (`.xlsx`) files.

---

## Project Structure
- `app.py`: Core Flask application containing route endpoints (`/upload`, `/calculate`, `/download`) and session management.
- `parser.py`: Robust PDF table extraction logic utilizing `pdfplumber` (optimized for multi-page tables) and OCR image parsing utilizing `pytesseract`.
- `utils.py`: Data formatting and cleaning utilities (dateutil parsing, Indian currency numbering, numeric cleaning).
- `wsgi.py`: WSGI entrypoint wrapper for production servers like Gunicorn.
- `Dockerfile`: Multi-stage Docker builder configuration incorporating Python 3.11 and the `tesseract-ocr` system binaries.
- `templates/`: User interface markup (`index.html`).
- `static/`: Client-side logic (`script.js`) and styling sheets (`style.css`).

---

## Local Setup & Run

### Prerequisites
- Python 3.11 or 3.12.
- **Tesseract OCR** (Required only for image uploads).
  - **Mac**: Install via Homebrew: `brew install tesseract`
  - **Ubuntu/Linux**: Install via apt: `sudo apt-get install tesseract-ocr`
  - **Windows**: Install via the [installer](https://github.com/UB-Mannheim/tesseract/wiki) and add the path to system environment variables.

### Installation
1. Clone the repository and navigate to the project directory:
   ```bash
   cd pdftoexpense
   ```

2. Install python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the development server:
   ```bash
   python3 app.py
   ```
   Open your browser and navigate to `http://127.0.0.1:5001`.

---

## Render Deployment

For the best experience, deploy the service as a **Docker Web Service** on Render. This ensures all system binaries (like Tesseract for image parsing) are installed automatically, and Gunicorn is configured with optimal timeouts.

### 1. Docker Web Service Deployment (Recommended)
1. Link your GitHub repository to your [Render Dashboard](https://dashboard.render.com/).
2. Create a new **Web Service**.
3. Set the **Runtime** setting to **Docker**. (Render will automatically build using the repository's `Dockerfile`).
4. Set the **Instance Type** (e.g. Free).
5. Leave the **Build Command** and **Start Command** blank (Render will read them from the Dockerfile).
6. Click **Deploy**.

### 2. Native Python Web Service Deployment (Alternative)
If you deploy as a native **Python Web Service**:
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: Add a high timeout parameter to support processing large files:
  ```bash
  gunicorn --bind 0.0.0.0:$PORT --timeout 300 wsgi:app
  ```
- *Note: Image parsing (PNG/JPG) will be disabled in this mode due to the absence of the Tesseract system binary.*
