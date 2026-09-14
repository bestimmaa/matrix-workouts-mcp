# Security

## Reporting

Email christoph.halang@gmail.com, or open a private security advisory on GitHub. This
is a personal project — expect a reply in days, not hours.

## What this server handles

- **A gym passcode**, if you give it one, used for a single sign-in request. It is
  never stored, logged or returned. Running without it, over a cache downloaded
  separately, is supported and is the tighter configuration.
- **A bearer token** from that sign-in, held in memory for the life of the process.
- **One person's workout history**, heart rate included, at ten-second resolution.
  Cached and exported files are written `0600` in a directory created `0700`.
- **A network listener, only if you ask for one.** `MCP_TRANSPORT=http` refuses to
  start without `MATRIX_MCP_TOKEN` and binds `127.0.0.1` unless `MATRIX_HTTP_HOST`
  says otherwise. The default transport, stdio, listens on nothing.

If you find a path where a passcode, a token or a ride reaches a log, an error
message, a file nobody asked for, or a network destination other than `apollo.jfit.co`,
that is a bug worth reporting.
