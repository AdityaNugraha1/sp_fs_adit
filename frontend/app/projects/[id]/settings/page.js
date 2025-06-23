'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useParams, useRouter } from 'next/navigation';
import { Dialog } from '@headlessui/react';

export default function ProjectSettings() {
  const { id } = useParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [msgError, setMsgError] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState([]);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempProjectName, setTempProjectName] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setIsOwner(false);
      return;
    }
    axios.get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        const userEmail = localStorage.getItem('userEmail');
        setIsOwner(res.data.owner?.email === userEmail);
        setOwnerEmail(res.data.owner?.email || '');
        setProjectName(res.data.name || '');
        // Combine owner and members (without duplicates)
        const memberList = [
          { id: res.data.owner?.id, email: res.data.owner?.email, isOwner: true },
          ...res.data.memberships
            .filter(m => m.user?.id !== res.data.owner?.id)
            .map(m => ({ id: m.user?.id, email: m.user?.email, isOwner: false }))
        ];
        setMembers(memberList);
      })
      .catch(() => {
        setIsOwner(false);
        setMembers([]);
      });
  }, [id]);

  async function invite(e) {
    e.preventDefault();
    const token = localStorage.getItem('token');
    try {
      await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/invite`, { email }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMsg('Invitation sent successfully!');
      setMsgError(false);
      setEmail('');
      // Refresh members
      const res = await axios.get(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const memberList = [
        { id: res.data.owner?.id, email: res.data.owner?.email, isOwner: true },
        ...res.data.memberships
          .filter(m => m.user?.id !== res.data.owner?.id)
          .map(m => ({ id: m.user?.id, email: m.user?.email, isOwner: false }))
      ];
      setMembers(memberList);
    } catch (err) {
      setMsgError(true);
      setMsg(
        err?.response?.data?.error
          ? `Failed to invite: ${err.response.data.error}`
          : 'Failed to send invitation'
      );
    }
  }

  async function deleteProject() {
    setIsDeleting(true);
    const token = localStorage.getItem('token');
    try {
      await axios.delete(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      router.push('/dashboard');
    } catch (error) {
      setIsDeleting(false);
      setIsDeleteModalOpen(false);
      setMsgError(true);
      setMsg('Failed to delete project. Please try again.');
    }
  }

  async function removeMember(userId) {
    const token = localStorage.getItem('token');
    try {
      await axios.delete(`${process.env.NEXT_PUBLIC_API_URL}/projects/${id}/member/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMembers(members.filter(m => m.id !== userId));
      setMsg('Member removed successfully');
      setMsgError(false);
    } catch {
      setMsgError(true);
      setMsg('Failed to remove member');
    }
  }

  function startEditingName() {
    setTempProjectName(projectName);
    setIsEditingName(true);
  }

  async function saveProjectName() {
    const token = localStorage.getItem('token');
    try {
      const response = await axios.patch(
        `${process.env.NEXT_PUBLIC_API_URL}/projects/${id}`,
        { name: tempProjectName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setProjectName(response.data.name);
      setIsEditingName(false);
      setMsg('Project name updated successfully');
      setMsgError(false);
    } catch (error) {
      setMsgError(true);
      setMsg('Failed to update project name');
    }
  }

  function cancelEditingName() {
    setIsEditingName(false);
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              {isEditingName ? (
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={tempProjectName}
                    onChange={(e) => setTempProjectName(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1"
                  />
                  <button
                    onClick={saveProjectName}
                    className="text-sm bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEditingName}
                    className="text-sm bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-gray-900">{projectName}</h1>
                  {isOwner && (
                    <button
                      onClick={startEditingName}
                      className="text-gray-500 hover:text-gray-700"
                      aria-label="Edit project name"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
            {isOwner && (
              <button
                onClick={() => setIsDeleteModalOpen(true)}
                className="text-red-600 hover:text-red-800 transition-colors"
                aria-label="Delete project"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>

          {/* Members Section */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Team Members</h2>
            <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
              <ul className="divide-y divide-gray-200">
                {members.map(m => (
                  <li key={m.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-100 transition-colors">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-indigo-600 font-medium">
                          {m.email.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">
                          {m.email}
                          {m.isOwner && (
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
                              Owner
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    {isOwner && !m.isOwner && (
                      <button
                        onClick={() => removeMember(m.id)}
                        className="text-xs px-3 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Invite Form */}
          {isOwner && (
            <div>
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Invite New Member</h2>
              <form onSubmit={invite} className="flex mb-6 gap-2">
                <input
                  className="border border-indigo-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 p-3 flex-1 rounded-lg transition"
                  placeholder="User email or username"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  type="text"
                  autoComplete="off"
                />
                <button className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white px-4 py-2 rounded-lg font-semibold shadow hover:from-indigo-600 hover:to-blue-600 transition">
                  Invite
                </button>
              </form>
            </div>
          )}

          {/* Status Message */}
          {msg && (
            <div className={`mt-4 p-3 rounded-md ${msgError ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {msg}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog
        open={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <Dialog.Title className="text-xl font-bold text-gray-900 mb-2">
              Delete Project
            </Dialog.Title>
            <Dialog.Description className="text-gray-600 mb-6">
              Are you sure you want to delete the project "{projectName}"? This action cannot be undone and all project data will be permanently removed.
            </Dialog.Description>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={deleteProject}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center justify-center"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Deleting...
                  </>
                ) : (
                  'Delete Project'
                )}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  );
}