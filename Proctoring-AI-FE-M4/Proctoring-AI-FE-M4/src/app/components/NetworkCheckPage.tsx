import { useEffect, useState } from "react";
import {
  MonitorUp,
  Wifi,
  Upload,
  Check,
  Loader2,
  ArrowLeft,
  ChevronRight,
  X,
  CheckCircle2,
  AlertCircle,
  Zap,
  Clock,
  Signal,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useNavigate, useParams } from "react-router-dom";

import { LobbyLayout } from "./LobbyLayout";
import {
  CheckCard,
  ActionButton,
  SectionHeader,
  ErrorMessage,
} from "./CheckCard";
import { examService } from "../../services/examService";
import { authService } from "../../services/authService";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import {
  getLobbyProgress,
  getRememberedDashboardExamEntry,
  hasCompletedSystemChecks,
  updateLobbyProgress,
} from "../utils/lobbyProgress";

type NetworkStatus = "excellent" | "good" | "poor";

type NetworkQuality = {
  speed: number;
  latency: number;
  status: NetworkStatus;
  jitter: number;
  packetLoss: number;
  online: boolean;
  effectiveType: string | null;
  source: "connection" | "probe" | "hybrid";
};

const average = (values: number[]) => (
  values.reduce((sum, value) => sum + value, 0) / values.length
);

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) {
    return 0;
  }

  const avg = average(values);
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
};

const cacheBust = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const probeEndpoint = async (url: string) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  const startedAt = performance.now();

  try {
    const response = await fetch(cacheBust(url), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`Network probe failed with status ${response.status}`);
    }

    await response.text();
    return performance.now() - startedAt;
  } catch (error: any) {
    // Treat probe timeouts/cancellations as expected "no response in time" signals.
    // We handle scoring upstream without noisy console errors.
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Network probe timed out");
      timeoutError.name = "AbortError";
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export function NetworkCheckPage() {
  const navigate = useNavigate();
  const { examId: routeExamId } = useParams();
  const examId = routeExamId || localStorage.getItem("examId") || "";
  const userId = localStorage.getItem("userId") || "";

  const {
    hasActiveScreenShare,
    screenShareDisplaySurface,
    error: screenRecorderError,
    requestScreenShare,
    startRecording,
  } = useScreenRecorder({ userId });

  const [screenSharingError, setScreenSharingError] = useState("");
  const [screenSharingApproved, setScreenSharingApproved] = useState(false);
  const [networkTesting, setNetworkTesting] = useState(false);
  const [networkTestComplete, setNetworkTestComplete] = useState(false);
  const [networkTestError, setNetworkTestError] = useState("");
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);

  const [examData, setExamData] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [pageError, setPageError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!examId) {
      navigate("/exam", { replace: true });
      return;
    }

    const rememberedExamId = getRememberedDashboardExamEntry();
    if (routeExamId && rememberedExamId !== String(routeExamId)) {
      navigate("/exam", { replace: true });
      return;
    }

    localStorage.setItem("examId", examId);
    const storedProgress = getLobbyProgress(examId);

    if (!hasCompletedSystemChecks(storedProgress)) {
      navigate(`/exam/${examId}`, { replace: true });
      return;
    }

    setNetworkTestComplete(Boolean(storedProgress.networkChecks?.networkTestComplete));
    setNetworkQuality(storedProgress.networkChecks?.networkQuality || null);
    setScreenSharingApproved(Boolean(storedProgress.networkChecks?.screenSharingAllowed));

    const fetchData = async (attempt = 0) => {
      setLoading(true);
      setPageError("");

      try {
        // Ensure backend proctoring pipeline is warmed up before the exam starts.
        examService.warmupProctoring().catch(() => {});

        const [profile, details] = await Promise.all([
          authService.getUserProfile(),
          examService.getExamDetails(examId),
        ]);
        setUserData(profile);
        setExamData(details);
      } catch (error) {
        console.error("Failed to fetch lobby data:", error);
        if ((error as any)?.code === "AUTH_EXPIRED") {
          navigate("/login", { replace: true });
          return;
        }

        // Retry up to 3 times with exponential backoff (2s, 4s, 8s)
        if (attempt < 3) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          console.log(`Retrying lobby data fetch in ${delay}ms (attempt ${attempt + 1}/3)`);
          setTimeout(() => fetchData(attempt + 1), delay);
          return;
        }

        if ((error as any)?.code === "NETWORK_ERROR") {
          setPageError("Network issue detected. Please reconnect and try again.");
          return;
        }
        setPageError("Unable to load exam details. Please go back and reopen your exam lobby.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [examId, navigate, routeExamId]);

  useEffect(() => {
    if (hasActiveScreenShare) {
      setScreenSharingApproved(true);
      setScreenSharingError("");
      return;
    }

    if (screenRecorderError) {
      setScreenSharingError(screenRecorderError);
    }
  }, [hasActiveScreenShare, screenRecorderError]);

  useEffect(() => {
    if (!examId) {
      return;
    }

    updateLobbyProgress(examId, {
      networkChecks: {
        screenSharingAllowed: screenSharingApproved,
        networkTestComplete,
        networkQuality,
      },
    });
  }, [examId, screenSharingApproved, networkTestComplete, networkQuality]);

  useEffect(() => {
    const connection = (navigator as any).connection;

    const invalidateNetworkResults = () => {
      setNetworkTestComplete(false);
      setNetworkTestError("Network conditions changed. Run the connection test again before starting the exam.");
    };

    const handleOffline = () => {
      setNetworkTestComplete(false);
      setNetworkQuality((current) => current
        ? { ...current, online: false, status: "poor" }
        : {
            speed: 0,
            latency: 999,
            status: "poor",
            jitter: 0,
            packetLoss: 100,
            online: false,
            effectiveType: null,
            source: "probe",
          });
      setNetworkTestError("You are offline. Reconnect to the internet and run the network test again.");
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", invalidateNetworkResults);
    connection?.addEventListener?.("change", invalidateNetworkResults);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", invalidateNetworkResults);
      connection?.removeEventListener?.("change", invalidateNetworkResults);
    };
  }, []);

  const handleRequestScreenSharing = async () => {
    setScreenSharingError("");
    try {
      await requestScreenShare();
      setScreenSharingApproved(true);
    } catch (error) {
      console.error("Screen sharing setup failed:", error);
    }
  };

  const handleNetworkTest = async () => {
    setNetworkTesting(true);
    setNetworkTestComplete(false);
    setNetworkTestError("");

    try {
      if (!navigator.onLine) {
        throw new Error("You appear to be offline.");
      }

      const apiBase = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, "");
      const sampleTargets = [`${apiBase}/`, `${window.location.origin}/`];
      const latencySamples: number[] = [];
      const totalSamples = 4;

      for (let index = 0; index < totalSamples; index += 1) {
        let sampleRecorded = false;

        for (const target of sampleTargets) {
          try {
            const latency = await probeEndpoint(target);
            latencySamples.push(latency);
            sampleRecorded = true;
            break;
          } catch (error) {
            // AbortError here usually means our own 8s timeout fired. Don't spam console.
            if ((error as any)?.name === "AbortError") {
              console.debug(`Network probe timed out for ${target}`);
            } else {
              console.warn(`Network probe failed for ${target}:`, error);
            }
          }
        }

        if (!sampleRecorded) {
          latencySamples.push(8000);
        }
      }

      const successfulSamples = latencySamples.filter((value) => value < 8000);
      if (successfulSamples.length === 0) {
        throw new Error("The network probe could not reach the exam server.");
      }

      const packetLoss = Number((((totalSamples - successfulSamples.length) / totalSamples) * 100).toFixed(1));
      const latency = average(successfulSamples);
      const jitter = standardDeviation(successfulSamples);

      const connection = (navigator as any).connection;
      const browserDownlink = typeof connection?.downlink === "number" ? connection.downlink : null;
      const browserEffectiveType = typeof connection?.effectiveType === "string" ? connection.effectiveType : null;
      const browserRtt = typeof connection?.rtt === "number" && connection.rtt > 0 ? connection.rtt : null;

      const resolvedLatency = Number((browserRtt ? Math.min(latency, browserRtt) : latency).toFixed(0));
      const fallbackSpeed = Math.max(
        1,
        Math.min(100, Number((35 - resolvedLatency / 8 - jitter / 6 - packetLoss / 3).toFixed(1))),
      );
      const speed = Number((browserDownlink ?? fallbackSpeed).toFixed(1));

      let status: NetworkStatus = "poor";
      if (packetLoss <= 5 && resolvedLatency <= 80 && jitter <= 25 && speed >= 8) {
        status = "excellent";
      } else if (packetLoss <= 15 && resolvedLatency <= 180 && jitter <= 70 && speed >= 2) {
        status = "good";
      }

      setNetworkQuality({
        speed,
        latency: resolvedLatency,
        status,
        jitter: Number(jitter.toFixed(0)),
        packetLoss,
        online: true,
        effectiveType: browserEffectiveType,
        source: browserDownlink ? "hybrid" : "probe",
      });
      setNetworkTestComplete(true);
    } catch (error: any) {
      console.error("Network test failed", error);
      setNetworkQuality({
        speed: 0,
        latency: 999,
        status: "poor",
        jitter: 0,
        packetLoss: 100,
        online: navigator.onLine,
        effectiveType: null,
        source: "probe",
      });
      setNetworkTestError(error?.message || "Unable to complete the network test. Please try again.");
      setNetworkTestComplete(true);
    } finally {
      setNetworkTesting(false);
    }
  };

  const handleConfigUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setConfigFile(file);
    }
  };

  const handleRemoveConfig = () => {
    setConfigFile(null);
  };

  const handleStartExam = async () => {
    if (!screenSharingApproved) {
      setScreenSharingError("Enable screen sharing in the exam lobby before starting.");
      return;
    }

    if (!networkTestComplete) {
      setNetworkTestError("Run and complete the network test before starting the exam.");
      return;
    }

    try {
      await startRecording({ promptIfNeeded: false });

      updateLobbyProgress(examId, {
        networkChecks: {
          screenSharingAllowed: true,
          networkTestComplete: true,
          networkQuality,
        },
      });

      localStorage.setItem("examId", examId);
      navigate(`/exam/${examId}/active`);
    } catch (error: any) {
      console.error("Failed to start exam recording from lobby:", error);
      setScreenSharingError(
        error?.message || "Screen sharing is no longer available. Enable it again before starting the exam.",
      );
    }
  };

  const canStartExam = screenSharingApproved && networkTestComplete;

  const completedCount = [screenSharingApproved, networkTestComplete].filter(Boolean).length;

  const statusColor = (status: string) => (
    status === "excellent"
      ? "text-emerald-600"
      : status === "good"
      ? "text-blue-600"
      : "text-amber-600"
  );

  const statusBg = (status: string) => (
    status === "excellent"
      ? "bg-emerald-50"
      : status === "good"
      ? "bg-blue-50"
      : "bg-amber-50"
  );

  return (
    <LobbyLayout
      currentStep={2}
      stepOneComplete
      stepTwoComplete={canStartExam}
      examData={examData}
      userData={userData}
    >
      <div className="mb-8 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full text-[13px] ${
              canStartExam
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-50 text-amber-600"
            }`}
          >
            {canStartExam ? <Check className="h-5 w-5" /> : `${completedCount}/2`}
          </div>
          <div>
            <p className="text-[14px] text-gray-900">
              {canStartExam ? "All checks passed - ready to begin" : "Final checks in progress"}
            </p>
            <p className="text-[12px] text-gray-500">
              {canStartExam
                ? "Click Start Exam when you're ready"
                : `${2 - completedCount} check${2 - completedCount !== 1 ? "s" : ""} remaining`}
            </p>
          </div>
        </div>
        {canStartExam && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] text-emerald-700">
              Ready
            </span>
          </motion.div>
        )}
      </div>

      {pageError && (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
          <p className="text-[13px] text-red-700">{pageError}</p>
        </div>
      )}

      <div className="mb-8">
        <SectionHeader
          title="Screen Monitoring"
          description="Allow screen sharing for exam supervision"
        />
        <CheckCard
          icon={MonitorUp}
          title="Screen Sharing Permission"
          description="Required for monitoring your screen during the exam"
          checked={screenSharingApproved}
          stepNumber={1}
          action={(
            <ActionButton
              onClick={handleRequestScreenSharing}
              completed={screenSharingApproved}
              label="Share Screen"
              completedLabel="Active"
            />
          )}
        >
          {screenSharingApproved && (
            <div className="ml-15 text-[12px] text-gray-500">
              Shared surface: {screenShareDisplaySurface || "screen selected"}
              {!hasActiveScreenShare ? " - waiting to reconnect session check" : ""}
            </div>
          )}
          {screenSharingError && <ErrorMessage message={screenSharingError} />}
        </CheckCard>
      </div>

      <div className="mb-8">
        <SectionHeader
          title="Network Quality"
          description="Run a real multi-sample connection test before you begin"
        />
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-4 p-5">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <div className="relative flex-shrink-0">
                <span
                  className={`absolute -left-1.5 -top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] ${
                    networkTestComplete
                      ? "bg-emerald-500 text-white"
                      : "bg-gray-400 text-white"
                  }`}
                >
                  {networkTestComplete ? <Check className="h-2.5 w-2.5" /> : "2"}
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
                  {networkTesting ? (
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                  ) : (
                    <Wifi className="h-5 w-5 text-emerald-600" />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-[14px] text-gray-900">Network Speed Test</h4>
                <p className="text-[13px] text-gray-500">
                  Measures server reachability, latency, jitter, and connection quality.
                </p>
              </div>
            </div>
            <button
              onClick={handleNetworkTest}
              disabled={networkTesting}
              className={`cursor-pointer rounded-lg px-4 py-2 text-[13px] transition-all duration-200 ${
                networkTestComplete
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : networkTesting
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
              }`}
            >
              {networkTesting ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Testing...
                </span>
              ) : networkTestComplete ? (
                <span className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Complete
                </span>
              ) : (
                "Run Test"
              )}
            </button>
          </div>

          {networkTestError && (
            <div className="px-5 pb-5">
              <ErrorMessage message={networkTestError} />
            </div>
          )}

          <AnimatePresence>
            {networkQuality && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="px-5 pb-5">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-4 grid grid-cols-3 gap-4">
                      <div className="rounded-lg border border-gray-100 bg-white p-3 text-center">
                        <div className="mb-1.5 flex items-center justify-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-[11px] uppercase tracking-wider text-gray-500">
                            Speed
                          </span>
                        </div>
                        <p className="text-[18px] text-gray-900">{networkQuality.speed.toFixed(1)}</p>
                        <p className="text-[11px] text-gray-400">Mbps</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-white p-3 text-center">
                        <div className="mb-1.5 flex items-center justify-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-[11px] uppercase tracking-wider text-gray-500">
                            Latency
                          </span>
                        </div>
                        <p className="text-[18px] text-gray-900">{networkQuality.latency.toFixed(0)}</p>
                        <p className="text-[11px] text-gray-400">ms</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-white p-3 text-center">
                        <div className="mb-1.5 flex items-center justify-center gap-1.5">
                          <Signal className="h-3.5 w-3.5 text-gray-400" />
                          <span className="text-[11px] uppercase tracking-wider text-gray-500">
                            Quality
                          </span>
                        </div>
                        <p className={`text-[18px] capitalize ${statusColor(networkQuality.status)}`}>
                          {networkQuality.status}
                        </p>
                        <p className="text-[11px] text-gray-400">Status</p>
                      </div>
                    </div>

                    <div className="mb-4 rounded-lg border border-gray-100 bg-white px-4 py-3 text-[12px] text-gray-600">
                      <div>Online: {networkQuality.online ? "Yes" : "No"}</div>
                      <div>Jitter: {networkQuality.jitter.toFixed(0)} ms</div>
                      <div>Packet loss: {networkQuality.packetLoss.toFixed(1)}%</div>
                      <div>
                        Connection source: {networkQuality.source}
                        {networkQuality.effectiveType ? ` (${networkQuality.effectiveType})` : ""}
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 rounded-lg p-3 ${statusBg(networkQuality.status)}`}>
                      <CheckCircle2 className={`h-4 w-4 ${statusColor(networkQuality.status)}`} />
                      <span className="text-[13px] text-gray-700">
                        {networkQuality.status === "excellent"
                          ? "Excellent connection - optimal for the monitored exam."
                          : networkQuality.status === "good"
                          ? "Good connection - suitable for the monitored exam."
                          : "Connection is weak or unstable. Move closer to your router or use a wired connection if possible."}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {networkTesting && (
            <div className="px-5 pb-5">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="mb-3 flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                  <span className="text-[13px] text-gray-600">
                    Testing network connection with repeated server probes...
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                  <motion.div
                    className="h-full rounded-full bg-emerald-500"
                    initial={{ width: "0%" }}
                    animate={{ width: "90%" }}
                    transition={{ duration: 2.8, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mb-8">
        <SectionHeader
          title="Configuration Upload"
          badge="Optional"
          description="Upload configuration file if provided by your institution"
        />
        <div className="rounded-xl border border-dashed border-gray-300 bg-white transition-all hover:border-emerald-300">
          <div className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                <Upload className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="mb-0.5 text-[14px] text-gray-900">Upload Configuration File</h4>
                <p className="text-[13px] text-gray-500">Accepts .json, .xml, or .config files</p>
              </div>
            </div>

            <div className="ml-15 mt-4">
              {!configFile ? (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50">
                  <Upload className="h-3.5 w-3.5" />
                  Choose File
                  <input
                    type="file"
                    accept=".json,.xml,.config"
                    onChange={handleConfigUpload}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="inline-flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <span className="max-w-[200px] truncate text-[13px] text-gray-800">
                    {configFile.name}
                  </span>
                  <button
                    onClick={handleRemoveConfig}
                    className="cursor-pointer rounded p-0.5 transition-all hover:bg-emerald-100"
                  >
                    <X className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/80 p-4">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-[13px] text-blue-800">
            Once you start the exam, the existing screen-sharing session from this
            lobby will be reused and your camera and microphone will be monitored
            throughout the exam. If your network changes, rerun the network test first.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pb-4 pt-2">
        <button
          onClick={() => navigate(`/exam/${examId}`)}
          className="flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] text-gray-600 transition-all hover:bg-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to System Check
        </button>

        <button
          onClick={handleStartExam}
          disabled={!canStartExam}
          className={`flex cursor-pointer items-center gap-2 rounded-xl px-8 py-3 text-[14px] transition-all duration-200 ${
            canStartExam
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-200 hover:bg-emerald-700 active:scale-[0.98]"
              : "cursor-not-allowed bg-gray-100 text-gray-400"
          }`}
        >
          Start Exam
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </LobbyLayout>
  );
}
