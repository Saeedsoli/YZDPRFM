FROM node:22-alpine

# ابزار بیلد برای better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && apk del make g++

COPY src ./src
COPY public ./public

# داده اولیه (کاتالوگ و مقالات) — بیرون از data/ چون Liara یک Disk
# پایدار روی /app/data سوار می‌کند و هر چیزی را که اینجا کپی شده
# باشد می‌پوشاند. اولین اجرا از seed/ خوانده و data/ را پر می‌کند.
COPY seed ./seed

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
# روی Liara به Disk پایدار وصل شود
ENV DB_PATH=/app/data/yazd.db

CMD ["node", "src/server.js"]
