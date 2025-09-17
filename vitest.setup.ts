process.on("unhandledRejection", (reason) => {
  if (
    reason instanceof Error &&
    /pglite|pgl_backend/i.test(reason.stack ?? reason.message ?? "")
  ) {
    return;
  }
  throw reason;
});
