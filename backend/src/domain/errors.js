class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class DependencyError extends Error {
  constructor(message = 'Verification provider is temporarily unavailable') {
    super(message);
    this.name = 'DependencyError';
  }
}

module.exports = { AppError, DependencyError };
