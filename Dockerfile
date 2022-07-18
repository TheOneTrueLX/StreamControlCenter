FROM node:16-alpine

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# create app directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# install dependencies
ADD . /usr/src/app
RUN mkdir -p /usr/src/app/src/public
RUN yarn && \
    yarn cache clean
CMD [ "yarn", "start" ]
EXPOSE 8008