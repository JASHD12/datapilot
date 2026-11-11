FROM python:3.12-slim
WORKDIR /app
ENV DATAPILOT_ROOT=/app
COPY . /app
RUN pip install --no-cache-dir .
EXPOSE 8000
CMD ["uvicorn", "datapilot.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

