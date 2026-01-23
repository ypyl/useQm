import { useState } from "react";
import { useMutation, useQuery } from "./useQm";

interface User {
  id: number;
  name: string;
}

interface UserDetail extends User {
  email: string;
  role: string;
}

function UserDetails({ userId, onClose }: { userId: number; onClose: () => void }) {
  const { data: user, loading, problemDetails } = useQuery<UserDetail>({ url: `/api/users/${userId}` });

  return (
    <div style={{ border: "1px solid #ccc", padding: "1rem", marginTop: "1rem" }}>
      <button onClick={onClose} style={{ float: "right" }}>
        Close
      </button>
      <h3>User Details (ID: {userId})</h3>

      {loading && <p>Loading details...</p>}

      {problemDetails && (
        <div style={{ color: "red", border: "1px solid red", padding: "1rem", backgroundColor: "#fff0f0" }}>
          <h4>
            Error: {problemDetails.title} (Status: {problemDetails.status})
          </h4>
          <p>{problemDetails.detail}</p>
          {problemDetails.type && <small>Type: {problemDetails.type}</small>}
        </div>
      )}

      {user && (
        <div>
          <p>
            <strong>Name:</strong> {user.name}
          </p>
          <p>
            <strong>Email:</strong> {user.email}
          </p>
          <p>
            <strong>Role:</strong> {user.role}
          </p>
        </div>
      )}
    </div>
  );
}

interface OptimisticUser extends User {
  isOptimistic: true;
}

function App() {
  const { data: users, loading, problemDetails, execute: refetchUsers } = useQuery<User[]>({ url: "/api/users", autoInvoke: true });
  const { execute: createUser, loading: creating } = useMutation<User>({ url: "/api/users" });
  const { execute: deleteUser, loading: deleting } = useMutation({ url: "/api/users", method: "DELETE" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [optimisticUsers, setOptimisticUsers] = useState<OptimisticUser[]>([]);
  const [deletingUserIds, setDeletingUserIds] = useState<Set<number>>(new Set());

  const handleCreateUser = async () => {
    const randomName = `User ${Math.floor(Math.random() * 1000)}`;
    const randomEmail = `user${Math.floor(Math.random() * 1000)}@example.com`;

    // Create optimistic user with temporary negative ID
    const tempId = -Date.now();
    const optimisticUser: OptimisticUser = {
      id: tempId,
      name: randomName,
      isOptimistic: true,
    };

    // Add to optimistic state immediately
    setOptimisticUsers((prev) => [...prev, optimisticUser]);

    // We can assume the internal mock handles the ID generation
    const newUser = {
      name: randomName,
      email: randomEmail,
      role: "User",
    };

    const result = await createUser({
      body: newUser,
    });

    if (result) {
      await refetchUsers();
    }

    // Remove from optimistic state
    setOptimisticUsers((prev) => prev.filter((u) => u.id !== tempId));
  };

  const handleDeleteUser = async (userId: number) => {
    // Add to deleting state immediately
    setDeletingUserIds((prev) => new Set(prev).add(userId));

    const result = await deleteUser(`/${userId}`);

    if (result) {
      await refetchUsers();
    }
    // Remove from deleting state
    setDeletingUserIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>User Management</h1>

      <div style={{ marginBottom: "1rem" }}>
        <button onClick={handleCreateUser} disabled={creating}>
          Add Random User
        </button>
      </div>

      <div style={{ minHeight: "1.5rem", marginBottom: "1rem" }}>
        {loading && deletingUserIds.size === 0 && <p>Loading users...</p>}
        {creating && <p>Creating user...</p>}
        {deletingUserIds.size > 0 && <p>Deleting user...</p>}
        {problemDetails && <p style={{ color: "red" }}>Error loading list: {problemDetails.title}</p>}
      </div>

      {users && (
        <ul style={{ textAlign: "left", listStyle: "none", padding: 0 }}>
          {/* Show real users, excluding ones being deleted */}
          {users
            .filter((user) => !deletingUserIds.has(user.id))
            .map((user) => (
              <li key={user.id} style={{ marginBottom: "0.5rem", padding: "0.5rem", border: "1px solid #eee" }}>
                <span style={{ marginRight: "1rem" }}>
                  {user.name} (ID: {user.id})
                </span>
                <button onClick={() => setSelectedId(user.id)} style={{ marginRight: "0.5rem" }}>
                  View Details
                </button>
                <button
                  onClick={() => handleDeleteUser(user.id)}
                  disabled={deleting}
                  style={{ backgroundColor: "#ff4444", color: "white" }}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </li>
            ))}
          {/* Show optimistic users second */}
          {optimisticUsers.map((user) => (
            <li
              key={user.id}
              style={{ marginBottom: "0.5rem", padding: "0.5rem", border: "1px solid #eee", opacity: 0.6 }}
            >
              <span style={{ marginRight: "1rem" }}>
                {user.name} (ID: {user.id})
              </span>
              <button disabled style={{ marginRight: "0.5rem" }}>
                View Details
              </button>
              <button disabled style={{ backgroundColor: "#ff4444", color: "white" }}>
                Delete
              </button>
              <span style={{ marginLeft: "0.5rem", fontSize: "0.8em", color: "#666" }}>(Creating...)</span>
            </li>
          ))}
        </ul>
      )}

      {selectedId !== null && (
        <UserDetails
          key={selectedId} /* Force re-mount on ID change to reset hook state if needed */
          userId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default App;
