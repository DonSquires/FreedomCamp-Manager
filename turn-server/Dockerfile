FROM alpine:3.20

RUN apk add --no-cache coturn bash

COPY turnserver.conf.template /etc/coturn/turnserver.conf.template
COPY entrypoint.sh /usr/local/bin/turn-entrypoint.sh

RUN chmod +x /usr/local/bin/turn-entrypoint.sh

EXPOSE 3478/tcp 3478/udp 5349/tcp 5349/udp 49160-49200/udp

ENTRYPOINT ["/usr/local/bin/turn-entrypoint.sh"]
