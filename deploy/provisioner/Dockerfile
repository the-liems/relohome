FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

RUN apk add --no-cache aws-cli
COPY --chmod=755 provision.sh /usr/local/bin/provision.sh
ENTRYPOINT ["/usr/local/bin/provision.sh"]
