FROM gitea/gitea:latest

WORKDIR /data

EXPOSE 3000

# Railway should mount a persistent volume at /data so repositories, avatars,
# and configuration survive restarts.
VOLUME ["/data"]