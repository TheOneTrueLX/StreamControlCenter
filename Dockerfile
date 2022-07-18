FROM node:16-alpine

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