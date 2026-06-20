// All data is static JSON committed by the pipeline. Paths are relative so the
// app works at https://<user>.github.io/GolfModel/ and on the dev server alike.

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`data/${path}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load data/${path} (${res.status})`);
  return (await res.json()) as T;
}
