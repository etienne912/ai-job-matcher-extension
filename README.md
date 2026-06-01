# Job Matcher Assistant

> Score job listings against your CV and preferences directly from the Chrome sidebar.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue.svg)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Job Matcher Assistant is a Chrome extension for quickly deciding whether a job is worth your time. It detects job listings, extracts the selected offer, sends it to your chosen AI provider, and returns a match score with a practical breakdown.

It works well with classic job pages and job-board layouts such as LinkedIn, where the page shows a list of jobs on one side and the selected job description in a detail panel.

---

## Features

- **Match score**: 0-100 compatibility score based on your CV and preferences.
- **Detailed breakdown**: Skills, seniority, salary, location, work arrangement, industry, and deal-breakers.
- **Hidden information check**: Highlights buried applicant instructions or screening tests found inside the offer.
- **LinkedIn-style job switching**: Re-detects the selected job when you click another offer in a job list/detail-panel layout.
- **Analysis modes**: Choose automatic analysis, ask-before-analysis, or manual-only mode.
- **History**: Keeps the last 30 analysed jobs and lets you clear history.
- **CV import**: Paste plain text or extract text from supported PDF/DOCX files using your configured AI provider.
- **Multiple providers**: Anthropic, OpenAI, Google Gemini, Mistral, and local Ollama.
- **Local settings**: CV, preferences, API keys, and history are stored in Chrome local storage.

---

## Screenshots

### Analysis View
![Job Analysis Example](docs/job_exemple.jpg)

### Settings
![Settings View](docs/settings.jpg)

---

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `ai-job-matcher-extension/` directory.
6. Pin the extension for easier access.

---

## Setup

Open the extension settings from the sidebar gear icon or from the extension options page.

1. Choose an AI provider.
2. Select a model.
3. Add an API key if the provider requires one.
4. Paste your CV as plain text, or use **Import CV file**.
5. Add your target roles, locations, salary, preferred work arrangement, must-have skills, and deal-breakers.
6. Choose how analysis should start when a job is detected.

### Analysis Modes

| Mode | What happens |
| :--- | :--- |
| **Analyse automatically** | The sidebar opens and starts scoring as soon as a job listing is detected. |
| **Ask before analysing** | The sidebar opens with an **Analyse job** button. This helps avoid accidental paid API calls. |
| **Manual only** | The extension stores detected job text silently. Open the sidebar and click analyse when you want. |

Manual analysis is always available from the sidebar with **Analyse this page**.

---

## Supported Providers

Provider and model metadata lives in `lib/providers.js`. Availability can vary by provider account and region.

| Provider | Example Models |
| :--- | :--- |
| **Anthropic** | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4.5`, `claude-haiku-4-5-20251001` |
| **OpenAI** | `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-mini`, `gpt-5.4-mini`, `gpt-4.1` |
| **Google Gemini** | `gemini-3.5-flash`, `gemini-3.1-flash`, `gemini-3.1-pro`, `gemini-2.5-pro` |
| **Mistral AI** | `mistral-small-latest`, `mistral-medium-latest`, `mistral-large-latest` |
| **Ollama** | Detected from your local Ollama library |

### API Keys

- [Anthropic Console](https://console.anthropic.com/)
- [OpenAI Platform](https://platform.openai.com/)
- [Google AI Studio](https://aistudio.google.com/)
- [Mistral Console](https://console.mistral.ai/)

---

## Using Ollama Locally

Ollama keeps analysis local, except for the page text and settings already stored by the extension.

1. Install [Ollama](https://ollama.com).
2. Run a model, for example:

```bash
ollama run llama3.1
```

3. Select **Ollama** in extension settings.
4. Pick one of your installed local models.

Note: Ollama chat does not support direct PDF/DOCX extraction in this extension. Paste your CV as text or use another provider for document extraction.

---

## Privacy and Cost Control

- CV text, preferences, API keys, and history are stored with `chrome.storage.local`.
- Job text and CV content are sent only to the provider/model you select.
- Cross-origin permissions are limited to configured AI provider APIs and local Ollama.
- The content script runs on normal `http` and `https` pages so it can detect job listings across job boards.
- Use **Ask before analysing** or **Manual only** mode if you want to avoid accidental paid API calls.

---

## How Detection Works

The content script looks for strong job-listing signals before triggering analysis:

- structured `JobPosting` data when available
- common job detail containers
- LinkedIn job detail panel updates
- job/careers-style URLs with enough job-specific language

On LinkedIn and similar sites, clicking another job in the list updates the selected offer without a full page reload. The extension watches the job detail panel and reprocesses the new selected job.

## Hidden Information Check

Some job posts include buried instructions for applicants, such as asking you to add a specific word, number, phrase, or formatting detail to your CV or cover letter. The analysis includes a **Hidden information found** section when the AI detects this kind of instruction.

Examples:

- "Include the square root of 81 at the bottom right of your CV."
- "Use the word pineapple in your cover letter."
- "Add the job reference in white text at the end of your application."

This section is separate from the match score. It is meant to help you notice application instructions that are easy to miss.

---

## Development

This is a plain Manifest V3 extension. There is no build step.

Run validation:

```bash
npm run validate
```

Run provider tests:

```bash
npm test
```

The validation script checks the manifest, extension assets, provider metadata, README images, and version consistency between `manifest.json` and `package.json`.

Provider tests use mocked `fetch` calls. They do not call real AI APIs.

---

## Architecture

- **Content script**: Extracts job text, detects selected-job changes, and avoids broad false-positive triggers.
- **Background service worker**: Stores per-tab job text and analysis, opens the side panel when appropriate, and calls AI providers.
- **Sidebar UI**: Shows loading, confirmation, errors, history, and analysis results.
- **Settings page**: Stores provider, model, CV, preferences, and analysis mode.
- **Provider layer**: Normalizes calls to Anthropic, OpenAI, Gemini, Mistral, and Ollama.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

Developed by Etienne Lecrivain.
