FROM docker.io/cloudflare/sandbox:0.7.18

# Upgrade glibc to 2.39+ — the base image ships Ubuntu 22.04 (glibc 2.35)
# but the presto binary is linked against glibc 2.39 (Ubuntu 24.04)
RUN echo "deb http://archive.ubuntu.com/ubuntu noble main" > /etc/apt/sources.list.d/noble.list && \
    apt-get update && \
    apt-get install --yes --only-upgrade libc6 && \
    rm /etc/apt/sources.list.d/noble.list && \
    rm -rf /var/lib/apt/lists/*

# Pre-install Tempo CLI
RUN curl -fsSL https://tempo.xyz/install | bash

# Pre-install mppx and claude-code globally
ENV PATH="/root/.tempo/bin:/root/.local/bin:/root/.bun/bin:${PATH}"
RUN bun upgrade \
    && bun add --global mppx@latest \
    opencode-ai@latest

ENV COMMAND_TIMEOUT_MS=300000
WORKDIR /root/workspace

RUN cat > /root/opencode.json <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "permission": "allow"
}
EOF

RUN bun add --global @anthropic-ai/claude-code@latest

# Pre-install Tempo skill for OpenCode
RUN mkdir -p /root/.config/opencode/skills/tempo-request && \
    curl -fsSL https://raw.githubusercontent.com/tempoxyz/wallet/refs/heads/main/SKILL.md \
         -o /root/.config/opencode/skills/tempo-request/SKILL.md

# Shell config
RUN echo 'export PS1="♦︎ "' >> /root/.bashrc

# Prevent tempo login from trying to launch a browser
ENV BROWSER=echo

RUN tempo update && tempoup --update && tempo wallet --help

# Required during local development to access exposed ports
EXPOSE 8080 3000 4096
