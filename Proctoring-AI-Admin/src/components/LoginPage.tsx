import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Mail, Key, AlertCircle } from 'lucide-react';

interface LoginPageProps {
  onLogin: (email: string, securityKey: string) => boolean;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [securityKey, setSecurityKey] = useState('');
  const [isFocused, setIsFocused] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthenticate = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate authentication delay
    setTimeout(() => {
      const success = onLogin(email, securityKey);
      if (!success) {
        setError('Invalid credentials. Please try again.');
        setIsLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        {/* Login Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          {/* Shield Icon */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-600 to-blue-600">
            <Shield className="h-8 w-8 text-white" />
          </div>

          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-3xl font-bold text-slate-900">
              Proctoring Command Center
            </h1>
            <div className="flex items-center justify-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4" />
              <p className="font-medium">Authorized Personnel Only</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleAuthenticate} className="space-y-5">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">
                Official Email
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setIsFocused('email')}
                  onBlur={() => setIsFocused(null)}
                  placeholder="you@institution.edu"
                  className={`w-full rounded-lg border ${
                    isFocused === 'email' 
                      ? 'border-cyan-500 ring-2 ring-cyan-500/20' 
                      : 'border-slate-300'
                  } bg-white py-3 pl-11 pr-4 text-slate-900 placeholder-slate-400 transition-all duration-200 focus:outline-none`}
                  required
                />
              </div>
            </div>

            {/* Security Key Input */}
            <div>
              <label htmlFor="securityKey" className="mb-2 block text-sm font-medium text-slate-700">
                Security Key
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <Key className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="securityKey"
                  type="password"
                  value={securityKey}
                  onChange={(e) => setSecurityKey(e.target.value)}
                  onFocus={() => setIsFocused('securityKey')}
                  onBlur={() => setIsFocused(null)}
                  placeholder="••••••••••••••••"
                  className={`w-full rounded-lg border ${
                    isFocused === 'securityKey' 
                      ? 'border-cyan-500 ring-2 ring-cyan-500/20' 
                      : 'border-slate-300'
                  } bg-white py-3 pl-11 pr-4 text-slate-900 placeholder-slate-400 transition-all duration-200 focus:outline-none`}
                  required
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Authenticate Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 py-3.5 font-semibold text-white shadow-lg transition-all hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Authenticating...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Authenticate
                  <Shield className="h-5 w-5" />
                </span>
              )}
            </button>
          </form>

          {/* Footer Info */}
          <div className="mt-6 text-center">
            <p className="text-xs text-slate-500">
              Secured by Advanced Encryption • ISO 27001 Certified
            </p>
          </div>
        </div>

        {/* Additional security badge */}
        <div className="mt-4 text-center text-xs text-slate-600">
          All access attempts are monitored and logged
        </div>
      </motion.div>
    </div>
  );
}
