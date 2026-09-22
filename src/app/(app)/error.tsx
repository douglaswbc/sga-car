"use client";

export default function AppError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <div className="content">
      <article className="panel">
        <header className="panel-header">
          <div>
            <h2>Algo deu errado</h2>
            <p>Não foi possível carregar esta área.</p>
          </div>
        </header>
        <div className="connection-body">
          <p className="form-message form-message--error" role="alert">
            {error.message || "Erro inesperado. Tente novamente."}
          </p>
          <div className="connection-actions">
            <button className="button" onClick={reset} type="button">Tentar novamente</button>
          </div>
        </div>
      </article>
    </div>
  );
}
