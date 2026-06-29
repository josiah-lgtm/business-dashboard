# syntax=docker/dockerfile:1.7
# Build context is the REPO ROOT (the SPA source lives there).
# Build the Vue SPA, then serve it from nginx with the /api proxy.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# VITE_* are inlined at build time. The URL + shared workspace key are safe to
# bake; the API TOKEN is deliberately NOT passed here (the nginx proxy injects it).
ARG VITE_API_URL=/api/external/kv
ARG VITE_WORKSPACE_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WORKSPACE_KEY=${VITE_WORKSPACE_KEY}
RUN npm run build

FROM nginx:alpine AS runtime
# Restrict envsubst to our two vars so nginx's own $host/$uri/$scheme survive.
ENV NGINX_ENVSUBST_FILTER="^(API_TOKEN|API_UPSTREAM)$"
COPY web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
