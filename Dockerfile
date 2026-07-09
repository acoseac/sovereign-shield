# Sovereign Shield — stateless, OpenAI-compatible sanitizing reverse proxy.
#
#   docker build -t sovereign-shield-proxy .
#   docker run -p 8000:8000 \
#     -e SOVEREIGN_UPSTREAM_BASE_URL=https://api.openai.com/v1 \
#     sovereign-shield-proxy
#
# Then point your OpenAI-compatible client's base URL at http://localhost:8000/v1
# — its API key is forwarded upstream unchanged, and nothing is stored.
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir ".[proxy]"

# Drop root: run the service as an unprivileged user.
RUN useradd --create-home --uid 10001 shield
USER shield

ENV HOST=0.0.0.0 \
    PORT=8000 \
    SOVEREIGN_UPSTREAM_BASE_URL=https://api.openai.com/v1
EXPOSE 8000
CMD ["sovereign-shield-proxy"]
