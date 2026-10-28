FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
VOLUME ["/app/data"]
EXPOSE 3000
# update yt-dlp on every start, YouTube changes often
CMD ["sh", "-c", "yt-dlp -U >/dev/null 2>&1; node src/index.js"]
