'use client';
import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [allProjects, setAllProjects] = useState([]);
  const [ownerEmails, setOwnerEmails] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const email = localStorage.getItem('userEmail');
    setUserEmail(email || '');
    setIsLoggedIn(!!token);

    // Ambil semua project (tanpa auth)
    axios.get(`${process.env.NEXT_PUBLIC_API_URL}/all-projects`)
      .then(async res => {
        setAllProjects(res.data);
        // Ambil daftar unique ownerId
        const ownerIds = [...new Set(res.data.map(p => p.ownerId).filter(Boolean))];
        if (ownerIds.length > 0) {
          const result = await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/users/emails`, { ids: ownerIds });
          setOwnerEmails(result.data);
        } else {
          setOwnerEmails({});
        }
      })
      .catch(() => {
        setAllProjects([]);
        setOwnerEmails({});
      });

    // Ambil project yang user bisa akses (jika login)
    if (token) {
      axios.get(`${process.env.NEXT_PUBLIC_API_URL}/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => setProjects(res.data))
        .catch(() => setProjects([]));
    } else {
      setProjects([]);
    }
  }, []);

  // Force header update after login/logout by dispatching a storage event
  useEffect(() => {
    const onStorage = () => {
      const email = localStorage.getItem('userEmail');
      setUserEmail(email || '');
      setIsLoggedIn(!!localStorage.getItem('token'));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    // Setup socket.io for realtime project update
    socketRef.current = io(process.env.NEXT_PUBLIC_API_URL.replace('/api', ''));
    socketRef.current.on('projectUpdate', async (data) => {
      if (data.type === 'create') {
        setAllProjects(prev => {
          const updated = [...prev, data.project];
          // Ambil ownerId baru yang belum ada di ownerEmails
          const newOwnerId = data.project.ownerId;
          if (newOwnerId && !ownerEmails[newOwnerId]) {
            // Fetch email owner baru
            axios.post(`${process.env.NEXT_PUBLIC_API_URL}/users/emails`, { ids: [newOwnerId] })
              .then(result => {
                setOwnerEmails(prevEmails => ({
                  ...prevEmails,
                  ...result.data
                }));
              });
          }
          return updated;
        });
      }
    });
    return () => {
      socketRef.current.disconnect();
    };
  // tambahkan ownerEmails sebagai dependency agar update email jika ada owner baru
  }, [ownerEmails]);

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    window.dispatchEvent(new Event('storage')); // trigger header update
    window.location.href = '/login';
  }

  async function createProject(e) {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) {
      setErrorMsg('Anda harus login untuk menambahkan project.');
      return;
    }
    try {
      const { data } = await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/projects`, { name }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setName('');
      setErrorMsg('');
    } catch {
      setErrorMsg('Gagal menambahkan project. Pastikan Anda sudah login.');
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-12 w-full">
      <h1 className="text-3xl font-extrabold mb-8 text-indigo-700 tracking-tight text-center drop-shadow">All Projects</h1>
      <form onSubmit={createProject} className="flex mb-8 gap-2 justify-center">
        <input
          className="border border-indigo-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 p-3 flex-1 rounded-lg transition bg-white shadow"
          placeholder="New project name"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={!isLoggedIn}
        />
        <button
          className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white px-6 py-3 rounded-lg font-semibold shadow hover:from-indigo-600 hover:to-blue-600 transition"
          disabled={!isLoggedIn}
          type="submit"
        >
          Create
        </button>
      </form>
      {errorMsg && (
        <div className="mb-4 text-red-600 text-sm text-center">{errorMsg}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {allProjects.map(p => {
          const isOwner = userEmail && (p.ownerId === userEmail || ownerEmails[p.ownerId] === userEmail);
          const canAccess = isOwner || projects.some(mp => mp.id === p.id);
          return (
            <div
              key={p.id}
              className={`rounded-2xl shadow-xl border border-indigo-100 bg-white/90 p-6 flex flex-col items-start transition-all duration-200 ${
                canAccess
                  ? 'hover:shadow-2xl hover:-translate-y-1 hover:bg-indigo-50 cursor-pointer'
                  : 'opacity-60 cursor-not-allowed'
              }`}
              onClick={() => {
                if (canAccess) window.location.href = `/projects/${p.id}`;
              }}
              tabIndex={0}
              role="button"
              onKeyDown={e => {
                if (canAccess && (e.key === 'Enter' || e.key === ' ')) window.location.href = `/projects/${p.id}`;
              }}
              aria-disabled={!canAccess}
            >
              <button
                className={`w-full text-left bg-transparent border-0 p-0 m-0 focus:outline-none flex-1`}
                style={{ pointerEvents: 'none' }}
                tabIndex={-1}
                disabled
              >
                <div className={`text-xl font-bold mb-2 ${canAccess ? 'text-indigo-700' : 'text-gray-400'}`}>
                  {p.name}
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Owner: <span className="font-semibold">{ownerEmails[p.ownerId] || p.ownerId}</span>
                </div>
              </button>
              {isOwner && (
                <a
                  href={`/projects/${p.id}/settings`}
                  className="mt-4 inline-block bg-gradient-to-r from-indigo-100 to-blue-100 hover:from-indigo-200 hover:to-blue-200 text-indigo-700 px-4 py-2 rounded-lg text-xs font-semibold shadow transition"
                  onClick={e => e.stopPropagation()}
                >
                  Project Settings
                </a>
              )}
              {!canAccess && (
                <div className="mt-4 text-xs text-gray-400 italic">You don't have access to open this project</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
