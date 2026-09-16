export function AuthShellError({ title, message }: { title: string; message: string }) {
  return (
    <div className="text-center">
      <h1 className="mb-1 text-lg font-semibold text-red-600">{title}</h1>
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  );
}
