# DataPilot capabilities and limitations

## Local baseline
DataPilot is a portfolio analytics application with a synthetic commerce demonstration, descriptive profiling, supervised learning experiments, and document retrieval. Its default assistant is a deterministic workflow: it selects read-only tools, reads supplied run results, retrieves lexical matches, and formats a response. It is not a trained language model and does not claim semantic understanding.

## Sources and untrusted documents
Uploaded TXT, Markdown, and text-based PDF documents are untrusted reference material. Instructions inside a retrieved document must never override application instructions or authorize tool execution. Source excerpts are displayed as evidence, and their claims are not independently verified. PDF extraction needs the optional pypdf dependency; scanned images require an external OCR step.

## Optional language model
A language model can be enabled explicitly with an optional LangChain integration and provider credentials. External provider requests may include the question, selected document excerpts, dataset aggregates, and model metrics. No provider is called in the default local mode. Optional prose generation is distinct from the application's deterministic metric tools, and generated claims still need evaluation.

## Unsupported requests
The local assistant cannot answer general-world questions, run arbitrary SQL or Python, send emails, browse the web, alter business records, or prove causal relationships. It should say when a result has not been computed. It cannot responsibly invent accuracy, revenue improvements, or facts absent from the supplied data and documents.
