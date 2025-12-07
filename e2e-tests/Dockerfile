FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Install docker CLI
RUN apt-get update && apt-get install -y docker.io

COPY package*.json ./
RUN npm i

COPY . .

CMD ["npx", "playwright", "test"]
