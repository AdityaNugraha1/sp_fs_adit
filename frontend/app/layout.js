'use client';
import './globals.css';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RootLayout({ children }) {
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    function updateUser() {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const email = typeof window !== 'undefined' ? localStorage.getItem('userEmail') : null;
      if (token && email) setUser({ email });
      else setUser(null);
    }
    updateUser();

    window.addEventListener('storage', updateUser);
    window.addEventListener('user-auth-changed', updateUser);

    return () => {
      window.removeEventListener('storage', updateUser);
      window.removeEventListener('user-auth-changed', updateUser);
    };
  }, []);

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userEmail');
    window.dispatchEvent(new Event('user-auth-changed'));
    router.push('/login');
  }

  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-100 font-sans text-gray-800">
        <div className="min-h-screen flex flex-col">
          <header className="w-full px-4 sm:px-6 lg:px-8 py-4 bg-white/90 shadow-sm flex items-center justify-between border-b border-indigo-100">
            <a href="/dashboard" className="text-xl sm:text-2xl font-bold text-indigo-600 tracking-tight flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              ProjectFlow
            </a>
            <nav className="space-x-4 flex items-center">
              {user ? (
                <div className="flex items-center space-x-4">
                  <span className="hidden sm:inline text-sm sm:text-base text-indigo-700 font-medium">{user.email}</span>
                  <button 
                    onClick={handleLogout}
                    className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  >
                    Keluar
                  </button>
                </div>
              ) : (
                <a 
                  href="/login" 
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-indigo-600 hover:bg-indigo-50 transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                >
                  Masuk
                </a>
              )}
            </nav>
          </header>
          <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}