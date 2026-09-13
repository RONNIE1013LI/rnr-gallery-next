export default function ManualShippingMigrationPage() {
  return (
    <main>
      <h1>Manual shipping migration</h1>
      <form action="/api/admin/migrations/manual-shipping" method="post">
        <button type="submit">Run migration</button>
      </form>
    </main>
  );
}
