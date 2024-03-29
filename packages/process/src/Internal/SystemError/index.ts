// ets_tracing: off

export const NODEJS_SYSTEM_ERROR_CODES = [
  "E2BIG",
  "EACCES",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
  "EAGAIN",
  "EALREADY",
  "EBADE",
  "EBADF",
  "EBADFD",
  "EBADMSG",
  "EBADR",
  "EBADRQC",
  "EBADSLT",
  "EBUSY",
  "ECANCELED",
  "ECHILD",
  "ECHRNG",
  "ECOMM",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EDEADLK",
  "EDEADLOCK",
  "EDESTADDRREQ",
  "EDOM",
  "EDQUOT",
  "EEXIST",
  "EFAULT",
  "EFBIG",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "EIDRM",
  "EILSEQ",
  "EINPROGRESS",
  "EINTR",
  "EINVAL",
  "EIO",
  "EISCONN",
  "EISDIR",
  "EISNAM",
  "EKEYEXPIRED",
  "EKEYREJECTED",
  "EKEYREVOKED",
  "EL2HLT",
  "EL2NSYNC",
  "EL3HLT",
  "EL3RST",
  "ELIBACC",
  "ELIBBAD",
  "ELIBMAX",
  "ELIBSCN",
  "ELIBEXEC",
  "ELOOP",
  "EMEDIUMTYPE",
  "EMFILE",
  "EMLINK",
  "EMSGSIZE",
  "EMULTIHOP",
  "ENAMETOOLONG",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENFILE",
  "ENOBUFS",
  "ENODATA",
  "ENODEV",
  "ENOENT",
  "ENOEXEC",
  "ENOKEY",
  "ENOLCK",
  "ENOLINK",
  "ENOMEDIUM",
  "ENOMEM",
  "ENOMSG",
  "ENONET",
  "ENOPKG",
  "ENOPROTOOPT",
  "ENOSPC",
  "ENOSR",
  "ENOSTR",
  "ENOSYS",
  "ENOTBLK",
  "ENOTCONN",
  "ENOTDIR",
  "ENOTEMPTY",
  "ENOTSOCK",
  "ENOTSUP",
  "ENOTTY",
  "ENOTUNIQ",
  "ENXIO",
  "EOPNOTSUPP",
  "EOVERFLOW",
  "EPERM",
  "EPFNOSUPPORT",
  "EPIPE",
  "EPROTO",
  "EPROTONOSUPPORT",
  "EPROTOTYPE",
  "ERANGE",
  "EREMCHG",
  "EREMOTE",
  "EREMOTEIO",
  "ERESTART",
  "EROFS",
  "ESHUTDOWN",
  "ESPIPE",
  "ESOCKTNOSUPPORT",
  "ESRCH",
  "ESTALE",
  "ESTRPIPE",
  "ETIME",
  "ETIMEDOUT",
  "ETXTBSY",
  "EUCLEAN",
  "EUNATCH",
  "EUSERS",
  "EWOULDBLOCK",
  "EXDEV",
  "EXFULL"
]

/**
 * Checks if the provided unknown value is a `NodeJS.ErrnoException` (i.e. a
 * `SystemError`).
 *
 * @link https://nodejs.org/api/errors.html#errors_class_systemerror
 */
export function isSystemError(u: unknown): u is NodeJS.ErrnoException {
  return (
    typeof u === "object" &&
    u != null &&
    Object.prototype.toString.call(u) === "[object Error]" &&
    "code" in u &&
    NODEJS_SYSTEM_ERROR_CODES.indexOf((u as any).code) !== -1
  )
}
