# Job Matcher Assistant — Chrome Extension

> **Stop wasting time on jobs that don't fit.** Instantly score any job listing against your CV and preferences — right in your browser sidebar.

Paste a job posting URL, open the sidebar, and get a structured match score with criteria breakdown powered by the AI model of your choice.

---

## Features

- **Instant scoring** — 0–100 match score with animated ring indicator
- **Criteria breakdown** — Skills, seniority, salary, work arrangement, industry, deal-breakers
- **Deal-breaker alert** — Visual warning on the score if a deal-breaker is detected
- **Full AI analysis** — 3–5 paragraph detailed assessment, expandable on demand
- **Auto-detection** — Recognises job listings automatically; re-runs on SPA navigation (LinkedIn, Greenhouse, Lever…)
- **Your choice of AI** — Anthropic, OpenAI, Gemini, Mistral, or a fully local Ollama model
- **Prompt caching** — Anthropic calls cache your CV and preferences so repeated analyses are faster and cheaper
- **Privacy-friendly** — Your CV and API keys stay in Chrome local storage; nothing is sent anywhere except your chosen AI provider

---

## Supported AI providers

| Provider | Models |
|---|---|
| **Anthropic (Claude)** | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` |
| **OpenAI** | `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-instant`, `o4-mini`, `gpt-4o` |
| **Google Gemini** | `gemini-3.1-pro`, `gemini-3.1-flash`, `gemini-3.0-flash` |
| **Mistral AI** | `mistral-small-latest`, `mistral-medium-latest`, `mistral-large-latest` |
| **Ollama (local)** | Any model installed locally — the list is pulled live from the Ollama API |

---

## Exemple

![job_exemple.jpg](docs/job_exemple.jpg)

---

## How to load the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this directory (`ai-job-matcher-extension/`)
5. The **Job Matcher Assistant** icon will appear in your toolbar

To open settings: right-click the toolbar icon → **Options**, or click the gear icon inside the sidebar.

---

## Where to get API keys

### Anthropic (Claude)
1. Go to <https://console.anthropic.com/>
2. Sign in or create an account
3. Navigate to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-…`)

### OpenAI
1. Go to <https://platform.openai.com/api-keys>
2. Sign in or create an account
3. Click **Create new secret key**
4. Copy the key (starts with `sk-…`)

### Google Gemini
1. Go to <https://aistudio.google.com/app/apikey>
2. Sign in with a Google account
3. Click **Create API key**
4. Copy the key

### Mistral AI
1. Go to <https://console.mistral.ai/api-keys/>
2. Sign in or create an account
3. Click **Create new key**
4. Copy the key (starts with `…`)

---

## How to use Ollama (local, free, private)

[Ollama](https://ollama.com) runs LLMs on your own machine — no API key, no data leaving your computer.

1. Install Ollama from <https://ollama.com/download>
2. Pull a model, e.g.:
   ```bash
   ollama pull llama3.2
   # or
   ollama pull mistral
   ```
3. Ollama starts automatically and listens on `http://localhost:11434`
4. In Job Matcher Assistant settings: select **Ollama (local)** as provider — the model dropdown is populated live from your local Ollama API, so any model you have pulled will appear automatically
5. Click **Test connection** to verify

> **Tip:** Larger models give significantly better analysis quality. `llama3.1:70b` or `mistral-large` will outperform smaller 7B models on structured JSON tasks.

---

## How it works

1. **Content script** runs on every page, extracts the main body text, and checks for job-listing keywords (`responsibilities`, `requirements`, `qualifications`, etc.). If at least 3 match, it sends the text (capped at 3 500 words) to the background service worker.
2. **Background** stores the text in `chrome.storage.session` (tab-scoped) and opens the Side Panel.
3. **Sidebar** loads your settings, builds the prompt with your CV and requirements, sends an AI request through the background (to keep API keys out of the content script), and renders the scored results.
4. The last analysis is cached in session storage so re-opening the sidebar doesn't re-call the API.
5. SPA navigation (LinkedIn, Greenhouse, etc.) is detected by patching `history.pushState` — the analysis reruns automatically when the URL changes.

---

## File structure

```
manifest.json        MV3 extension manifest
background.js        Service worker — AI calls, session storage, panel management
content.js           Injected script — page text extraction, job detection
sidebar.html/js      Chrome Side Panel UI — score ring, criteria, deal-breaker alert
settings.html/js     Options page — provider, CV, requirements
lib/providers.js     AI provider abstraction (Anthropic, OpenAI, Gemini, Mistral, Ollama)
icons/               Extension icons (16, 48, 128 px)
```

---

## Known limitations

- **Auto-open**: Chrome 116+ restricts `sidePanel.open()` to user gesture handlers. Auto-opening on job detection may silently fail depending on Chrome version; the panel can always be opened manually via the toolbar icon.
- **Job detection heuristic**: The keyword-matching heuristic works on most major job boards but may miss highly formatted pages or fire on non-job pages that happen to contain the trigger words. Use **Analyse this page** in the sidebar to force analysis on any page.
- **Text extraction**: Very dynamic pages (heavy React/Angular SPAs) may need a second or two to finish rendering before the content script reads the text. If the analysis seems thin, click **Re-analyse**.
- **Ollama context**: Smaller local models have limited context windows and may return incomplete or malformed JSON. If structured parsing fails, the raw AI output is shown in the "Full AI analysis" section.
- **No streaming**: Responses are returned all at once; the loading spinner will show for however long the API takes.
- **Close button**: The Chrome Side Panel cannot be closed programmatically. The × button attempts `window.close()` which works in some Chrome versions; otherwise close the panel from the browser chrome (the × in the panel frame, or toggle the toolbar icon).

---

## License

MIT © 2026 Etienne lecrivain — see [LICENSE](LICENSE) for details.
