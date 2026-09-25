import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { motion } from 'motion/react';
import {
  User,
  Bell,
  Shield,
  Eye,
  Database,
  Mail,
  Lock,
  Save,
  RefreshCw,
  AlertTriangle,
  Check,
  Camera,
  Volume2,
  Smartphone,
  Monitor,
  Clock,
  Zap,
  Users,
  Download,
  Upload,
  Copy
} from 'lucide-react';

export function AdminSettings() {
  const [activeSection, setActiveSection] = useState('profile');
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileDepartment, setProfileDepartment] = useState('Computer Science');
  const [profileRole, setProfileRole] = useState('Admin');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [enableNotifications, setEnableNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [soundAlerts, setSoundAlerts] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Proctoring Settings State
  const [faceDetection, setFaceDetection] = useState(true);
  const [phoneDetection, setPhoneDetection] = useState(true);
  const [multiplePersons, setMultiplePersons] = useState(true);
  const [audioMonitoring, setAudioMonitoring] = useState(false);
  const [tabSwitching, setTabSwitching] = useState(true);
  const [copyPaste, setCopyPaste] = useState(true);
  const [autoTerminate, setAutoTerminate] = useState(false);

  // AI Configuration State
  const [aiSensitivity, setAiSensitivity] = useState(75);
  const [confidenceThreshold, setConfidenceThreshold] = useState(85);
  const [modelVersion, setModelVersion] = useState('ProctorAI v3.2 (Recommended)');
  const [processingMode, setProcessingMode] = useState('Real-time Optimized');

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const sections = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'security', name: 'Security', icon: Shield },
    { id: 'system', name: 'System', icon: Database },
  ];

  const loadProfileImage = async () => {
    try {
      const response = await api.get('auth/me/image', { responseType: 'blob' });
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfileImage(reader.result as string);
      };
      reader.readAsDataURL(response.data);
    } catch (err) {
      console.error('Failed to load profile image:', err);
      setProfileImage(null);
    }
  };

  const fetchAllSettings = async () => {
    try {
      setIsLoading(true);
      // Fetch Profile
      const profileRes = await api.get('auth/me');
      const { full_name, email, department, role, has_image } = profileRes.data;
      setProfileName(full_name || '');
      setProfileEmail(email || '');
      setProfileDepartment(department || 'Computer Science');
      setProfileRole(role || 'Admin');

      if (has_image) {
        await loadProfileImage();
      } else {
        setProfileImage(null);
      }

      const settingsRes = await api.get('settings');
      const s = settingsRes.data;
      setEnableNotifications(s.enable_notifications);
      setEmailAlerts(s.email_alerts);
      setSoundAlerts(s.sound_alerts);

      setError(null);
    } catch (err: any) {
      console.error('Failed to fetch settings:', err);
      setError('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllSettings();
  }, []);

  const handleSave = async () => {
    try {
      if (activeSection === 'profile') {
        await api.patch('auth/me', {
          full_name: profileName,
          email: profileEmail,
          department: profileDepartment
        });
      } else {
        // Save notification settings only
        await api.patch('settings', {
          enable_notifications: enableNotifications,
          email_alerts: emailAlerts,
          sound_alerts: soundAlerts
        });
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setError(null);
    } catch (err: any) {
      console.error('Failed to save settings:', err);
      setError(err.response?.data?.detail || 'Failed to save settings. Please try again.');
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      setIsUpdatingPassword(true);
      await api.post('auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword
      });

      setSaveSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Failed to update password:', err);
      setError(err.response?.data?.detail || 'Failed to update password. Please check your current password.');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Only JPEG and PNG images are allowed');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      await api.patch('auth/me/image', formData);
      await loadProfileImage();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Image upload failed:', err);
      setError('Failed to upload image');
    }
  };

  const handleImageRemove = async () => {
    try {
      await api.delete('auth/me/image');
      setProfileImage(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Image removal failed:', err);
      setError('Failed to remove image');
    }
  };

  const handleReset = () => {
    fetchAllSettings();
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent">
              Settings
            </h1>
            <p className="text-slate-600">Configure your proctoring system preferences</p>
          </div>

          <button
            onClick={handleSave}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-3 font-semibold text-white shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {saveSuccess ? (
              <>
                <Check className="h-5 w-5" />
                Saved Changes
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Save All Settings
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            <AlertTriangle className="h-5 w-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          {/* Left Sidebar - Navigation */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
              <nav className="space-y-2">
                {sections.map((section, index) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;

                  return (
                    <motion.button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ x: 4 }}
                      className={`group relative w-full overflow-hidden rounded-lg p-3 text-left transition-all duration-300 ${isActive
                        ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-slate-900 shadow-md'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                    >
                      {/* Active indicator */}
                      {isActive && (
                        <motion.div
                          layoutId="activeSection"
                          className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-cyan-400 to-blue-500"
                          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        />
                      )}

                      <div className="flex items-center gap-3">
                        <Icon
                          className={`h-5 w-5 transition-colors ${isActive ? 'text-cyan-600' : 'text-slate-400 group-hover:text-cyan-600'
                            }`}
                        />
                        <span className="text-sm font-medium">{section.name}</span>
                      </div>
                    </motion.button>
                  );
                })}
              </nav>
            </div>

            {/* System Status */}
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="relative">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-green-500 opacity-75" />
                </div>
                <span className="text-sm font-semibold text-green-900">All Systems Operational</span>
              </div>
              <p className="text-xs text-green-700">Last updated: 2 min ago</p>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="lg:col-span-3">
            <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-lg">
              {/* Profile Section */}
              {activeSection === 'profile' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg">
                      <User className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Profile Settings</h2>
                      <p className="text-sm text-slate-600">Manage your personal information</p>
                    </div>
                  </div>

                  {/* Profile Picture */}
                  <div>
                    <label className="mb-3 block text-sm font-medium text-slate-700">Profile Picture</label>
                    <div className="flex items-center gap-6">
                      <div className="relative flex-shrink-0">
                        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-cyan-500 to-blue-600 shadow-xl ring-1 ring-slate-200">
                          {profileImage ? (
                            <img
                              src={profileImage}
                              alt="Profile"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="text-3xl font-bold text-white">
                              {profileName.split(' ').map(n => n[0]).join('').toUpperCase() || 'AD'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <input
                          type="file"
                          id="avatar-upload"
                          style={{ display: 'none' }}
                          accept="image/jpeg,image/png"
                          onChange={handleImageUpload}
                        />
                        <button
                          onClick={() => document.getElementById('avatar-upload')?.click()}
                          className="flex items-center gap-2 rounded-lg border border-cyan-600 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-600 transition-all hover:bg-cyan-100"
                        >
                          <Upload className="h-4 w-4" />
                          Upload New
                        </button>
                        <button
                          onClick={handleImageRemove}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Name */}
                  <div>
                    <label htmlFor="name" className="mb-2 block text-sm font-medium text-slate-700">
                      Full Name
                    </label>
                    <input
                      id="name"
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2">
                        <Mail className="h-5 w-5 text-slate-400" />
                      </div>
                      <input
                        id="email"
                        type="email"
                        value={profileEmail}
                        onChange={(e) => setProfileEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>

                  {/* Department */}
                  <div>
                    <label htmlFor="department" className="mb-2 block text-sm font-medium text-slate-700">
                      Department
                    </label>
                    <select
                      id="department"
                      value={profileDepartment}
                      onChange={(e) => setProfileDepartment(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    >
                      <option value="Computer Science">Computer Science</option>
                      <option value="Mathematics">Mathematics</option>
                      <option value="Physics">Physics</option>
                      <option value="Chemistry">Chemistry</option>
                      <option value="Engineering">Engineering</option>
                    </select>
                  </div>

                  {/* Role */}
                  <div>
                    <label htmlFor="role" className="mb-2 block text-sm font-medium text-slate-700">
                      Role
                    </label>
                    <input
                      id="role"
                      type="text"
                      value={profileRole}
                      disabled
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600"
                    />
                  </div>
                </motion.div>
              )}

              {/* Proctoring Rules Section */}
              {activeSection === 'proctoring' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg">
                      <Eye className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Proctoring Rules</h2>
                      <p className="text-sm text-slate-600">Configure violation detection settings</p>
                    </div>
                  </div>

                  {/* Detection Toggles */}
                  <div className="space-y-4">
                    {/* Face Detection */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Camera className="h-5 w-5 text-cyan-600" />
                          Face Detection
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Flag when student's face is not visible or looking away
                        </p>
                      </div>
                      <button
                        onClick={() => setFaceDetection(!faceDetection)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${faceDetection ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: faceDetection ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    {/* Phone Detection */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Smartphone className="h-5 w-5 text-blue-600" />
                          Phone Detection
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Detect mobile phones or electronic devices in frame
                        </p>
                      </div>
                      <button
                        onClick={() => setPhoneDetection(!phoneDetection)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${phoneDetection ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: phoneDetection ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    {/* Multiple Persons */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Users className="h-5 w-5 text-purple-600" />
                          Multiple Persons Detection
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Flag when more than one person is detected in frame
                        </p>
                      </div>
                      <button
                        onClick={() => setMultiplePersons(!multiplePersons)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${multiplePersons ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: multiplePersons ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    {/* Audio Monitoring */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Volume2 className="h-5 w-5 text-green-600" />
                          Audio Monitoring
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Detect voices and suspicious audio patterns
                        </p>
                      </div>
                      <button
                        onClick={() => setAudioMonitoring(!audioMonitoring)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${audioMonitoring ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: audioMonitoring ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    {/* Tab Switching */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Monitor className="h-5 w-5 text-amber-600" />
                          Tab Switching Detection
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Monitor when student switches browser tabs or windows
                        </p>
                      </div>
                      <button
                        onClick={() => setTabSwitching(!tabSwitching)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${tabSwitching ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: tabSwitching ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>

                    {/* Copy-Paste Detection */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <Copy className="h-5 w-5 text-indigo-600" />
                          Copy-Paste Detection
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Detect and prevent copying or pasting during the exam
                        </p>
                      </div>
                      <button
                        onClick={() => setCopyPaste(!copyPaste)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${copyPaste ? 'bg-cyan-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: copyPaste ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Auto-Terminate */}
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                          Auto-Terminate on Critical Violations
                        </div>
                        <p className="mt-1 text-xs text-red-700">
                          Automatically end exam when critical violations exceed threshold
                        </p>
                      </div>
                      <button
                        onClick={() => setAutoTerminate(!autoTerminate)}
                        className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${autoTerminate ? 'bg-red-600' : 'bg-slate-300'
                          }`}
                      >
                        <motion.div
                          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                          animate={{ left: autoTerminate ? '26px' : '4px' }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* AI Configuration Section */}
              {activeSection === 'ai' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
                      <Zap className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">AI Configuration</h2>
                      <p className="text-sm text-slate-600">Adjust AI model sensitivity and thresholds</p>
                    </div>
                  </div>

                  {/* AI Sensitivity */}
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">AI Detection Sensitivity</label>
                      <span className="rounded-full bg-cyan-100 px-3 py-1 text-sm font-semibold text-cyan-700">
                        {aiSensitivity}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={aiSensitivity}
                      onChange={(e) => setAiSensitivity(Number(e.target.value))}
                      className="w-full accent-cyan-600"
                    />
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>Low (More Permissive)</span>
                      <span>High (Stricter)</span>
                    </div>
                    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs text-blue-700">
                        <strong>Current:</strong> {aiSensitivity < 33 ? 'Low' : aiSensitivity < 67 ? 'Medium' : 'High'} sensitivity - {
                          aiSensitivity < 33
                            ? 'Fewer flags, may miss some violations'
                            : aiSensitivity < 67
                              ? 'Balanced detection with moderate false positives'
                              : 'Maximum detection, higher false positive rate'
                        }
                      </p>
                    </div>
                  </div>

                  {/* Confidence Threshold */}
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">Minimum Confidence Threshold</label>
                      <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
                        {confidenceThreshold}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="95"
                      step="5"
                      value={confidenceThreshold}
                      onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                      className="w-full accent-purple-600"
                    />
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>50% (Less Confident)</span>
                      <span>95% (Very Confident)</span>
                    </div>
                    <p className="mt-3 text-xs text-slate-600">
                      Only flag violations when AI confidence is above {confidenceThreshold}%
                    </p>
                  </div>

                  {/* AI Model Version */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">AI Model Version</label>
                    <select
                      value={modelVersion}
                      onChange={(e) => setModelVersion(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    >
                      <option>ProctorAI v3.2 (Recommended)</option>
                      <option>ProctorAI v3.1 (Stable)</option>
                      <option>ProctorAI v3.0 (Legacy)</option>
                      <option>ProctorAI v4.0 Beta (Experimental)</option>
                    </select>
                  </div>

                  {/* Processing Mode */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Processing Mode</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setProcessingMode('Real-time Optimized')}
                        className={`rounded-lg border-2 p-4 text-left transition-all ${processingMode === 'Real-time Optimized' || processingMode === 'Real-time'
                          ? 'border-cyan-500 bg-cyan-50'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                          }`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <Zap className={`h-5 w-5 ${processingMode === 'Real-time Optimized' || processingMode === 'Real-time' ? 'text-cyan-600' : 'text-slate-400'}`} />
                          {(processingMode === 'Real-time Optimized' || processingMode === 'Real-time') && <Check className="h-5 w-5 text-cyan-600" />}
                        </div>
                        <p className="text-sm font-semibold text-slate-900">Real-time</p>
                        <p className="mt-1 text-xs text-slate-600">Process frames immediately</p>
                      </button>
                      <button
                        onClick={() => setProcessingMode('Batch Process')}
                        className={`rounded-lg border-2 p-4 text-left transition-all ${processingMode === 'Batch Process' || processingMode === 'Batch'
                          ? 'border-cyan-500 bg-cyan-50'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                          }`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <Clock className={`h-5 w-5 ${processingMode === 'Batch Process' || processingMode === 'Batch' ? 'text-cyan-600' : 'text-slate-400'}`} />
                          {(processingMode === 'Batch Process' || processingMode === 'Batch') && <Check className="h-5 w-5 text-cyan-600" />}
                        </div>
                        <p className="text-sm font-semibold text-slate-900">Batch</p>
                        <p className="mt-1 text-xs text-slate-600">Process after exam ends</p>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Notifications Section */}
              {activeSection === 'notifications' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg">
                      <Bell className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Notification Preferences</h2>
                      <p className="text-sm text-slate-600">Manage how you receive alerts</p>
                    </div>
                  </div>

                  {/* Enable Notifications */}
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-900">Enable Notifications</div>
                      <p className="mt-1 text-xs text-slate-600">Receive alerts for exam activities</p>
                    </div>
                    <button
                      onClick={() => setEnableNotifications(!enableNotifications)}
                      className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${enableNotifications ? 'bg-cyan-600' : 'bg-slate-300'
                        }`}
                    >
                      <motion.div
                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                        animate={{ left: enableNotifications ? '26px' : '4px' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {/* Email Alerts */}
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Mail className="h-4 w-4 text-cyan-600" />
                        Email Alerts
                      </div>
                      <p className="mt-1 text-xs text-slate-600">Get critical alerts via email</p>
                    </div>
                    <button
                      onClick={() => setEmailAlerts(!emailAlerts)}
                      className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${emailAlerts ? 'bg-cyan-600' : 'bg-slate-300'
                        }`}
                    >
                      <motion.div
                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                        animate={{ left: emailAlerts ? '26px' : '4px' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {/* Sound Alerts */}
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Volume2 className="h-4 w-4 text-blue-600" />
                        Sound Alerts
                      </div>
                      <p className="mt-1 text-xs text-slate-600">Play sound when violations occur</p>
                    </div>
                    <button
                      onClick={() => setSoundAlerts(!soundAlerts)}
                      className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${soundAlerts ? 'bg-cyan-600' : 'bg-slate-300'
                        }`}
                    >
                      <motion.div
                        className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-lg"
                        animate={{ left: soundAlerts ? '26px' : '4px' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {/* Alert Frequency */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Alert Frequency</label>
                    <select className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                      <option>Immediate (Real-time)</option>
                      <option>Every 5 minutes (Batched)</option>
                      <option>Hourly Summary</option>
                      <option>Daily Digest</option>
                    </select>
                  </div>

                  {/* Notification Types */}
                  <div>
                    <label className="mb-3 block text-sm font-medium text-slate-700">Notify Me About:</label>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          defaultChecked
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                        <span className="text-sm text-slate-700">Critical violations (10+ flags)</span>
                      </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          defaultChecked
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                        <span className="text-sm text-slate-700">Exam start/end events</span>
                      </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                        <span className="text-sm text-slate-700">Student login/logout</span>
                      </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          defaultChecked
                          className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0"
                        />
                        <span className="text-sm text-slate-700">System errors or failures</span>
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Security Section */}
              {activeSection === 'security' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-pink-600 shadow-lg">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Security Settings</h2>
                      <p className="text-sm text-slate-600">Manage authentication and access control</p>
                    </div>
                  </div>

                  {/* Change Password */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Current Password</label>
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2">
                        <Lock className="h-5 w-5 text-slate-400" />
                      </div>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                    />
                  </div>

                  <button
                    onClick={handleUpdatePassword}
                    disabled={isUpdatingPassword}
                    className="rounded-lg border border-cyan-600 bg-cyan-50 px-6 py-2 text-sm font-medium text-cyan-600 transition-all hover:bg-cyan-100 disabled:opacity-50"
                  >
                    {isUpdatingPassword ? 'Updating...' : 'Update Password'}
                  </button>

                  {/* Two-Factor Authentication */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-900">Two-Factor Authentication</div>
                        <p className="mt-1 text-xs text-slate-600">Add an extra layer of security to your account</p>
                      </div>
                      <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50">
                        Enable
                      </button>
                    </div>
                  </div>

                  {/* Session Management */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Active Sessions</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                        <div>
                          <p className="text-sm font-medium text-green-900">Current Session</p>
                          <p className="text-xs text-green-700">Chrome on Windows • Last active: Now</p>
                        </div>
                        <span className="rounded-full bg-green-500 px-2 py-1 text-xs font-semibold text-white">Active</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">Previous Session</p>
                          <p className="text-xs text-slate-600">Safari on MacOS • Last active: 2 hours ago</p>
                        </div>
                        <button className="text-xs font-medium text-red-600 hover:text-red-700">Revoke</button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* System Section */}
              {activeSection === 'system' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div className="mb-6 flex items-center gap-3 border-b border-slate-200 pb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 shadow-lg">
                      <Database className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">System Configuration</h2>
                      <p className="text-sm text-slate-600">Advanced system settings and maintenance</p>
                    </div>
                  </div>

                  {/* Storage Settings */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Storage Management</h3>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm text-slate-700">Evidence Storage Used</span>
                        <span className="text-sm font-semibold text-slate-900">487 GB / 2 TB</span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: '24%' }} />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">Evidence auto-deletes after 90 days</p>
                    </div>
                  </div>

                  {/* Data Retention */}
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Data Retention Period</label>
                    <select className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
                      <option>30 days</option>
                      <option>60 days</option>
                      <option selected>90 days (Recommended)</option>
                      <option>180 days</option>
                      <option>1 year</option>
                      <option>Indefinite</option>
                    </select>
                  </div>

                  {/* Backup & Export */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Backup & Export</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50">
                        <Download className="h-4 w-4" />
                        Export Data
                      </button>
                      <button className="flex items-center justify-center gap-2 rounded-lg border border-cyan-600 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-600 transition-all hover:bg-cyan-100">
                        <Upload className="h-4 w-4" />
                        Import Settings
                      </button>
                    </div>
                  </div>

                  {/* System Status */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">System Health</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-sm font-medium text-green-900">AI Engine</span>
                        </div>
                        <span className="text-xs font-semibold text-green-700">Operational</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-sm font-medium text-green-900">Database</span>
                        </div>
                        <span className="text-xs font-semibold text-green-700">Connected</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-sm font-medium text-green-900">MinIO Storage</span>
                        </div>
                        <span className="text-xs font-semibold text-green-700">Healthy</span>
                      </div>
                    </div>
                  </div>

                  {/* Maintenance Mode */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                          <AlertTriangle className="h-5 w-5 text-amber-600" />
                          Maintenance Mode
                        </div>
                        <p className="mt-1 text-xs text-amber-700">Disable student access for system updates</p>
                      </div>
                      <button className="rounded-lg border border-amber-600 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition-all hover:bg-amber-50">
                        Enable
                      </button>
                    </div>
                  </div>

                  {/* Clear Cache */}
                  <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50">
                    <RefreshCw className="h-4 w-4" />
                    Clear System Cache
                  </button>
                </motion.div>
              )}

              {/* Save Button - Always at bottom */}
              <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6">
                <div>
                  {saveSuccess && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2 text-sm font-medium text-green-600"
                    >
                      <Check className="h-4 w-4" />
                      Settings saved successfully!
                    </motion.div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReset}
                    className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50"
                  >
                    Reset to Defaults
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-3 font-semibold text-white shadow-lg shadow-cyan-500/30 transition-all hover:shadow-cyan-500/50"
                  >
                    <Save className="h-5 w-5" />
                    Save Changes
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
}
