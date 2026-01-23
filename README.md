# useQm

`useQm` is a lightweight, zero-dependency (except React) in-place alternative to libraries like React Query (but without caching, debouncing, or other advanced features). It allows you to decouple loading states, error handling, and data fetching/posting from your component logic.

It is designed to be **copied directly into your project** rather than being installed as a formal library.

## Key Features

- **Decoupled States**: Separate `data`, `loading`, and `problemDetails` for clean UI logic.
- **Problem Details Support**: Native support for `application/problem+json` style errors.
- **Zero Configuration**: No complex setup required; `QmProvider` is optional.
- **Type Safe**: First-class TypeScript support for queries, mutations, and server-sent events.
- **Auto-abort**: Automatically cancels pending requests when a component unmounts or a new request is triggered.
- **Server-Sent Events**: Native support for real-time streaming via `useSse` with automatic reconnection.

## Limitations

As a lightweight alternative, `useQm` intentionally omits advanced features found in full-fledged libraries like React Query or TanStack Query:

- **No Caching**: Data is not cached between requests; each fetch retrieves fresh data.
- **No Background Refetching**: No automatic refetching on window focus, network reconnection, or stale data handling.
- **No Debouncing or Throttling**: Requests are executed immediately without rate limiting.
- **No Optimistic Updates**: Mutations do not support speculative UI updates.
- **No Query Invalidation**: No mechanism to invalidate and refetch related queries after mutations.
- **Simplified Retry Logic**: Only supports basic exponential backoff for network errors (5xx status codes).

If your application requires these features, consider using a more comprehensive library. `useQm` is ideal for simple use cases where you want minimal overhead and full control.

## Installation

Since `useQm` is not a package, simply copy [useQm.tsx](./src/useQm.tsx) into your project's source directory (e.g., `src/hooks/useQm.tsx`).

## Setup (Optional)

You can optionally wrap your application with the `QmProvider` to provide global configuration for authentication and error tracking. If you don't need these features, you can skip this step entirely.

```tsx
import { QmProvider } from './hooks/useQm';

function Root() {
  return (
    <QmProvider
      getAuthHeader={async () => `Bearer ${localStorage.getItem('token')}`}
      trackError={(err, details) => console.error(err, details)}
    >
      <App />
    </QmProvider>
  );
}
```

## Usage

### Fetching Data (`useQuery`)

The `useQuery` hook handles GET requests and manages the loading state automatically.

```tsx
import { useQuery } from './hooks/useQm';

function UserList() {
  const { data: users, loading, problemDetails, execute: refetch } = useQuery<User[]>('/api/users');

  if (loading) return <p>Loading...</p>;
  if (problemDetails) return <p>Error: {problemDetails.title}</p>;

  return (
    <div>
      <ul>
        {users?.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  );
}
```

### Mutating Data (`useMutation`)

The `useMutation` hook handles data modifications (POST, PUT, DELETE, etc.).

```tsx
import { useMutation } from './hooks/useQm';

function CreateUser() {
  const { execute: create, loading } = useMutation<User>('/api/users/create');

  const handleCreate = async () => {
    const newUser = await create({
      body: JSON.stringify({ name: 'New User' })
    });

    if (newUser) {
      console.log('User created:', newUser);
    }
  };

  return (
    <button onClick={handleCreate} disabled={loading}>
      {loading ? 'Creating...' : 'Add User'}
    </button>
  );
}
```

### Server-Sent Events (`useSse`)

The `useSse` hook establishes a persistent server-sent events (SSE) connection and automatically reconnects on disconnect. Messages are parsed as JSON by default.

**Note**: Browser `EventSource` cannot set custom HTTP headers. Authentication is handled via query parameters (token-in-URL). Use a short-lived token or ensure your server-side implementation supports this pattern.

```tsx
import { useSse } from './hooks/useQm';

function LiveUpdates() {
  const { data: update, loading, problemDetails, abort } = useSse<Update>({
    url: '/api/updates',
    authQueryParam: 'access_token', // Token from getAuthHeader will be appended as query param
  });

  if (problemDetails) return <p>Connection error: {problemDetails.detail}</p>;

  return (
    <div>
      <p>Connected: {loading ? 'Yes' : 'No'}</p>
      {update && <p>Latest update: {update.message}</p>}
      <button onClick={() => abort()}>Disconnect</button>
    </div>
  );
}
```

## API Reference

### `useQuery<T>(url, options?)`
- **`data`**: The fetched data of type `T`.
- **`loading`**: Boolean indicating if the fetch is in progress.
- **`problemDetails`**: Error details if the request failed.
- **`execute(dynamicUrl?, dynamicOptions?)`**: Function to manually trigger or refetch. By default, does not auto-invoke; set `autoInvoke: true` in options to enable.
- **`abort()`**: Function to cancel the current request.

### `useMutation<T>(url, options?)`
- **`data`**: The result of the mutation.
- **`loading`**: Boolean indicating if the mutation is in progress.
- **`problemDetails`**: Error details if the request failed.
- **`execute(dynamicUrl?, dynamicOptions?)`**: Function to trigger the mutation.
- **`abort()`**: Function to cancel the current request.

### `useSse<T>(options?)`
- **`url`**: The SSE endpoint URL.
- **`authQueryParam`**: Query parameter name for authentication token (default: `'access_token'`). If provided, the token from `getAuthHeader()` will be automatically appended to the URL.
- **`data`**: The last received and parsed message of type `T`.
- **`loading`**: Boolean indicating if the connection is open.
- **`problemDetails`**: Error details if connection or message parsing fails.
- **`execute(dynamicUrl?)`**: Function to manually open or restart the connection.
- **`abort()`**: Function to close the connection.
