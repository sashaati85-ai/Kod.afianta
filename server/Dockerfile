FROM node:22-alpine

WORKDIR /app
COPY server/server.js /app/server.js
COPY index.html /app/site/index.html
COPY assets /app/site/assets
COPY .nojekyll /app/site/.nojekyll

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "/app/server.js"]
