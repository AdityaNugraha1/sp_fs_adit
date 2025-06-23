'use client';
import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { useParams, useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { Bar } from 'react-chartjs-2';
import Chart from 'chart.js/auto';

export default function ProjectBoard() {
  const { id } = useParams();
  const router = useRouter();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const socketRef = useRef(null);

  // Form fields
  const [assignee, setAssignee] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [status, setStatus] = useState('todo');
  const [errorMsg, setErrorMsg] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  // Fungsi untuk mendapatkan token dengan pengecekan
  const getToken = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return null;
    }
    return token;
  };

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    // Fungsi untuk handle error
    const handleApiError = (error) => {
      if (error.response?.status === 401 || error.response?.status === 403) {
        setAccessDenied(true);
        localStorage.removeItem('token');
        router.push('/login');
      }
    };

    // Fetch project data
    axios
      .get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setProject(res.data);
        setTasks(res.data.tasks);
        setMembers([res.data.owner, ...res.data.memberships.map((m) => m.user)]);
      })
      .catch(handleApiError);

    // Fetch analytics
    axios
      .get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setAnalytics(res.data))
      .catch(handleApiError);

    // Initialize Socket.IO
    socketRef.current = io(process.env.NEXT_PUBLIC_API_URL.replace('/api', ''), {
      auth: { token }
    });
    socketRef.current.emit('joinProject', id);

    socketRef.current.on('taskUpdate', ({ type, task, taskId }) => {
      const updateToken = getToken();
      if (!updateToken) return;

      setTasks((prev) => {
        let updatedTasks;
        if (type === 'create' || type === 'update') {
          let newTask = { ...task };
          if (newTask.assigneeId && !newTask.assignee) {
            const found = members.find((m) => m.id === newTask.assigneeId);
            if (found) {
              newTask.assignee = { id: found.id, email: found.email };
            } else {
              newTask.assignee = null;
            }
          }
          if (type === 'create') {
            updatedTasks = [...prev, newTask];
          } else {
            updatedTasks = prev.map((t) => (t.id === task.id ? newTask : t));
          }
        } else if (type === 'delete') {
          updatedTasks = prev.filter((t) => t.id !== taskId);
        } else {
          updatedTasks = prev;
        }
        return updatedTasks;
      });

      axios
        .get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/analytics`, {
          headers: { Authorization: `Bearer ${updateToken}` },
        })
        .then((res) => setAnalytics(res.data))
        .catch(handleApiError);
    });

    socketRef.current.on('connect_error', (err) => {
      if (err.message === 'Authentication error') {
        localStorage.removeItem('token');
        router.push('/login');
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leaveProject', id);
        socketRef.current.disconnect();
      }
    };
  }, [id, members, router]);

  // Fungsi-fungsi lainnya tetap sama, tapi tambahkan pengecekan token di awal
  async function addTask(e) {
    e.preventDefault();
    setErrorMsg('');
    if (!title.trim()) {
      setErrorMsg('Judul harus diisi');
      return;
    }
    const token = getToken();
    if (!token) return;

    try {
      await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/tasks`,
        {
          title,
          description: desc,
          status,
          assigneeId: assignee || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTitle('');
      setDesc('');
      setAssignee('');
      setStatus('todo');
      setIsAddingTask(false);
    } catch (error) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        setErrorMsg('Gagal menambahkan task. Silakan coba lagi.');
      }
    }
  }

  async function updateTask(e) {
    e.preventDefault();
    setErrorMsg('');
    if (!title.trim()) {
      setErrorMsg('Judul harus diisi');
      return;
    }
    const token = localStorage.getItem('token');
    try {
      await axios.patch(
        `${process.env.NEXT_PUBLIC_API_URL}/tasks/${editingTask.id}`,
        {
          title,
          description: desc,
          status,
          assigneeId: assignee || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTitle('');
      setDesc('');
      setAssignee('');
      setStatus('todo');
      setEditingTask(null);
    } catch (error) {
      setErrorMsg('Gagal memperbarui task. Silakan coba lagi.');
    }
  }

  function startEditing(task) {
    setEditingTask(task);
    setTitle(task.title);
    setDesc(task.description || '');
    setStatus(task.status);
    setAssignee(task.assignee?.id || '');
  }

  function cancelEditing() {
    setEditingTask(null);
    setTitle('');
    setDesc('');
    setStatus('todo');
    setAssignee('');
  }

  async function moveTask(taskId, newStatus) {
    const token = localStorage.getItem('token');
    await axios.patch(
      `${process.env.NEXT_PUBLIC_API_URL}/tasks/${taskId}`,
      { status: newStatus },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }

  async function deleteTask(taskId) {
    const token = localStorage.getItem('token');
    await axios.delete(`${process.env.NEXT_PUBLIC_API_URL}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  async function exportProject() {
    const token = localStorage.getItem('token');
    const res = await axios.get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statuses = ['todo', 'in-progress', 'done'];
  const statusColors = {
    'todo': 'bg-amber-100 border-amber-300',
    'in-progress': 'bg-blue-100 border-blue-300',
    'done': 'bg-green-100 border-green-300'
  };
  const statusTitles = {
    'todo': 'To Do',
    'in-progress': 'In Progress',
    'done': 'Done'
  };

  if (accessDenied) {
    return (
      <div className="max-w-xl mx-auto py-12 w-full text-center">
        <div className="bg-red-100 text-red-700 p-6 rounded-xl shadow-lg border border-red-200">
          <h2 className="text-xl font-bold mb-2">Akses Ditolak</h2>
          <p>Anda tidak memiliki izin untuk mengakses proyek ini.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-indigo-700">{project?.name}</h1>
          {project?.description && (
            <p className="text-gray-600 mt-1">{project.description}</p>
          )}
        </div>
        <button
          onClick={exportProject}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-5 py-2.5 rounded-lg shadow hover:from-indigo-600 hover:to-purple-700 transition-all hover:shadow-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          Export JSON
        </button>
      </div>

      {/* Analytics Section */}
      <div className="mb-10 bg-white rounded-xl shadow-lg p-6 border border-gray-200">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Analisis Task</h2>
        <div className="h-64">
          <Bar
            data={{
              labels: analytics.map((a) => statusTitles[a.status] || a.status),
              datasets: [{
                label: 'Tasks',
                data: analytics.map((a) => a.count),
                backgroundColor: [
                  'rgba(245, 158, 11, 0.7)',
                  'rgba(59, 130, 246, 0.7)',
                  'rgba(16, 185, 129, 0.7)'
                ],
                borderColor: [
                  'rgba(245, 158, 11, 1)',
                  'rgba(59, 130, 246, 1)',
                  'rgba(16, 185, 129, 1)'
                ],
                borderWidth: 1,
                borderRadius: 6
              }],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  padding: 12,
                  cornerRadius: 8,
                  usePointStyle: true,
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: { stepSize: 1 },
                  grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                  grid: { display: false }
                }
              },
            }}
          />
        </div>
      </div>

      {/* Task Management */}
      <div className="mb-6">
        {(isAddingTask || editingTask) ? (
          <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              {editingTask ? 'Edit Task' : 'Buat Task Baru'}
            </h2>
            <form onSubmit={editingTask ? updateTask : addTask} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Judul*</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Judul task"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deskripsi</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Deskripsi task"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>{statusTitles[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assignee</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members
                    .filter((m) => m && m.id && m.email)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.email}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex items-end gap-2 col-span-1 md:col-span-2 lg:col-span-5">
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md transition-colors"
                >
                  {editingTask ? 'Perbarui Task' : 'Buat Task'}
                </button>
                <button
                  type="button"
                  onClick={editingTask ? cancelEditing : () => setIsAddingTask(false)}
                  className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-md transition-colors"
                >
                  Batal
                </button>
              </div>
              {errorMsg && (
                <div className="text-red-600 text-sm col-span-1 md:col-span-2 lg:col-span-5">
                  {errorMsg}
                </div>
              )}
            </form>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingTask(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors shadow"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Tambah Task Baru
          </button>
        )}
      </div>

      {/* Task Boards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statuses.map(s => (
          <div
            key={s}
            className={`${statusColors[s]} p-4 rounded-xl border shadow-sm min-h-[300px]`}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              if (draggedTaskId) {
                moveTask(draggedTaskId, s);
                setDraggedTaskId(null);
              }
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg capitalize text-gray-800">
                {statusTitles[s]}
              </h2>
              <span className="bg-white/80 text-gray-700 px-2 py-1 rounded-full text-xs font-medium">
                {tasks.filter(t => t.status === s).length} task
              </span>
            </div>
            
            <div className="space-y-3">
              {tasks.filter(t => t.status === s).map(t => (
                <div
                  key={t.id}
                  className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={() => setDraggedTaskId(t.id)}
                  onDragEnd={() => setDraggedTaskId(null)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-gray-800">{t.title}</h3>
                      {t.description && (
                        <p className="text-sm text-gray-600 mt-1">{t.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(t);
                        }}
                        className="text-gray-400 hover:text-indigo-500 transition-colors"
                        type="button"
                        title="Edit Task"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTask(t.id);
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        type="button"
                        title="Delete Task"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div className="text-xs text-gray-500">
                      {t.assignee && t.assignee.email ? (
                        <span className="inline-flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                          {t.assignee.email}
                        </span>
                      ) : (
                        <span className="text-gray-400">Unassigned</span>
                      )}
                    </div>
                    
                    <div className="flex gap-1">
                      {statuses.filter(ns => ns !== s).map(ns => (
                        <button
                          key={ns}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveTask(t.id, ns);
                          }}
                          className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition-colors"
                          type="button"
                        >
                          {statusTitles[ns]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              
              {tasks.filter(t => t.status === s).length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <p className="mt-2">Tidak ada task disini</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}