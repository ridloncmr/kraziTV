/** Shared request feedback keeps validation, offline and pending states visible in every program. */
export function RequestFeedback({
  loading,
  error,
  message,
}: {
  loading?: boolean;
  error?: Error;
  message?: string;
}) {
  return (
    <div className="request-feedback" aria-live="polite">
      {loading && <p role="status">Working… Please wait.</p>}
      {error && (
        <p role="alert" className="error-message">
          {error.message}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
