export class ApiError extends Error {
  constructor(message,status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}

// Cliente compartilhado pelo site e painel. Nunca repete gravações automaticamente.
export function createApiClient({base = '',timeout = 15000,fetchImpl = globalThis.fetch,onUnauthorized = () => {}} = {}) {
  return async (path,options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),timeout);
    try {
      const response = await fetchImpl(base + path,{...options,credentials:'same-origin',signal:controller.signal});
      let data;
      try { data = await response.json(); }
      catch { throw new ApiError('O servidor retornou uma resposta inválida. Abra o site pelo endereço do servidor.',response.status); }
      if (!response.ok) {
        if (response.status === 401) onUnauthorized(path);
        throw new ApiError(data.error || 'Não foi possível concluir a solicitação.',response.status);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError('O servidor demorou a responder. Atualize a consulta para verificar se a operação foi concluída antes de tentar novamente.');
      if (error instanceof TypeError) throw new ApiError('Não foi possível conectar. Confira sua conexão e tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  };
}
