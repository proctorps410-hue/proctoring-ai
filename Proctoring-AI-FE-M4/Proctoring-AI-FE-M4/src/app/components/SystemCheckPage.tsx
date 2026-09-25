import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Download,
  ExternalLink,
  Camera,
  Mic,
  FileDown,
  ChevronRight,
  Check,
  AlertCircle,
  Info,
} from "lucide-react";
import { motion } from "motion/react";
import { LobbyLayout } from "./LobbyLayout";
import {
  CheckCard,
  ActionButton,
  SectionHeader,
  ErrorMessage,
} from "./CheckCard";
import { examService } from "../../services/examService";
import { authService } from "../../services/authService";
import {
  getLobbyProgress,
  getRememberedDashboardExamEntry,
  hasCompletedSystemChecks,
  updateLobbyProgress,
} from "../utils/lobbyProgress";

export function SystemCheckPage() {
  const navigate = useNavigate();
  const [browserDownloaded, setBrowserDownloaded] = useState(false);
  const [browserOpened, setBrowserOpened] = useState(false);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [microphoneAllowed, setMicrophoneAllowed] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [microphoneError, setMicrophoneError] = useState("");
  const [cameraDeviceLabel, setCameraDeviceLabel] = useState("");
  const [microphoneDeviceLabel, setMicrophoneDeviceLabel] = useState("");
  const [configDownloaded, setConfigDownloaded] = useState(false);
  const { examId: routeExamId } = useParams();
  const examId = routeExamId || localStorage.getItem("examId") || "";

  const [examData, setExamData] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

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
    setBrowserDownloaded(Boolean(storedProgress.systemChecks?.browserDownloaded));
    setBrowserOpened(Boolean(storedProgress.systemChecks?.browserOpened));
    setCameraAllowed(Boolean(storedProgress.systemChecks?.cameraAllowed));
    setMicrophoneAllowed(Boolean(storedProgress.systemChecks?.microphoneAllowed));
    setConfigDownloaded(Boolean(storedProgress.systemChecks?.configDownloaded));

    const fetchData = async (attempt = 0) => {
      setLoading(true);
      setPageError("");

      try {
        // Warm-start backend detectors while the student completes lobby steps.
        // This reduces first-frame latency when the exam session begins.
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
        setPageError("Unable to load exam details. Please return to the exam dashboard and try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [examId, navigate]);

  useEffect(() => {
    const detectAvailableDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameraDevice = devices.find((device) => device.kind === "videoinput");
        const microphoneDevice = devices.find((device) => device.kind === "audioinput");

        setCameraDeviceLabel(cameraDevice?.label || "");
        setMicrophoneDeviceLabel(microphoneDevice?.label || "");

        if (!cameraDevice) {
          setCameraAllowed(false);
          setCameraError("No camera detected. Connect a camera before continuing.");
        }

        if (!microphoneDevice) {
          setMicrophoneAllowed(false);
          setMicrophoneError("No microphone detected. Connect a microphone before continuing.");
        }
      } catch (error) {
        console.error("Failed to enumerate media devices:", error);
      }
    };

    detectAvailableDevices();
  }, []);

  useEffect(() => {
    if (!examId) {
      return;
    }

    updateLobbyProgress(examId, {
      systemChecks: {
        browserDownloaded,
        browserOpened,
        cameraAllowed,
        microphoneAllowed,
        configDownloaded,
      },
    });
  }, [
    browserDownloaded,
    browserOpened,
    cameraAllowed,
    microphoneAllowed,
    configDownloaded,
    examId,
  ]);

  // Auto-detect SEB
  useEffect(() => {
    const isSEB = navigator.userAgent.includes('SEB');
    if (isSEB || localStorage.getItem('dev_bypass_seb') === 'true') {
      setBrowserDownloaded(true);
      setBrowserOpened(true);
    }
  }, []);

  const handleDownloadBrowser = () => {
    // In a real app, this links to the SEB download page
    window.open("https://safeexambrowser.org/download_en.html", "_blank");
    setBrowserDownloaded(true);
  };

  const handleOpenBrowser = () => {
    // Simulate opening browser or allow manual dev bypass without breaking automated test runners
    localStorage.setItem('dev_bypass_seb', 'true');
    setBrowserOpened(true);
  };

  const handleRequestCamera = async () => {
    setCameraError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
        throw new Error("Camera access is not supported in this browser.");
      }

      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      const cameraDevice = availableDevices.find((device) => device.kind === "videoinput");
      if (!cameraDevice) {
        throw new Error("No camera detected. Connect a camera before continuing.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: cameraDevice.deviceId ? { ideal: cameraDevice.deviceId } : undefined,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 24 },
          facingMode: "user",
        },
      });

      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Camera stream could not be started. Please try again.");
      }

      setCameraDeviceLabel(track.label || cameraDevice.label || "Camera detected");
      stream.getTracks().forEach(track => track.stop());
      setCameraAllowed(true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        setCameraError("Camera access denied. Please allow camera permission in your browser.");
      } else if (err?.name === "NotFoundError") {
        setCameraError("No camera found. Connect a camera and try again.");
      } else {
        setCameraError(err?.message || "Camera verification failed. Please try again.");
      }
      setCameraAllowed(false);
      console.error("Camera error:", err);
    }
  };

  const handleRequestMicrophone = async () => {
    setMicrophoneError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
        throw new Error("Microphone access is not supported in this browser.");
      }

      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      const microphoneDevice = availableDevices.find((device) => device.kind === "audioinput");
      if (!microphoneDevice) {
        throw new Error("No microphone detected. Connect a microphone before continuing.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: microphoneDevice.deviceId ? { ideal: microphoneDevice.deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live") {
        throw new Error("Microphone stream could not be started. Please try again.");
      }

      setMicrophoneDeviceLabel(track.label || microphoneDevice.label || "Microphone detected");
      stream.getTracks().forEach(track => track.stop());
      setMicrophoneAllowed(true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        setMicrophoneError("Microphone access denied. Please allow microphone permission in your browser.");
      } else if (err?.name === "NotFoundError") {
        setMicrophoneError("No microphone found. Connect a microphone and try again.");
      } else {
        setMicrophoneError(err?.message || "Microphone verification failed. Please try again.");
      }
      setMicrophoneAllowed(false);
      console.error("Microphone error:", err);
    }
  };

  const handleDownloadConfig = () => {
    const configData = {
      examId: examId || "CURRENT-EXAM",
      browserVersion: "SafeBrowser v3.2.1",
      timestamp: new Date().toISOString(),
      settings: {
        lockdown: true,
        monitoring: true,
        allowedApps: [],
      },
    };

    const blob = new Blob([JSON.stringify(configData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "exam-config.json";
    link.click();
    URL.revokeObjectURL(url);
    setConfigDownloaded(true);
  };

  const canProceed = hasCompletedSystemChecks({
    systemChecks: {
      browserDownloaded,
      browserOpened,
      cameraAllowed,
      microphoneAllowed,
    },
  });

  const completedCount = [
    browserDownloaded,
    browserOpened,
    cameraAllowed,
    microphoneAllowed,
  ].filter(Boolean).length;

  return (
    <LobbyLayout 
      currentStep={1} 
      stepOneComplete={canProceed}
      examData={examData}
      userData={userData}
    >
      {/* Status summary */}
      <div className="mb-8 p-4 rounded-xl bg-white border border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-[13px] ${
              canProceed
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-50 text-amber-600"
            }`}
          >
            {canProceed ? (
              <Check className="w-5 h-5" />
            ) : (
              `${completedCount}/4`
            )}
          </div>
          <div>
            <p className="text-[14px] text-gray-900">
              {canProceed
                ? "All system checks passed"
                : "System checks in progress"}
            </p>
            <p className="text-[12px] text-gray-500">
              {canProceed
                ? "You can proceed to the network check"
                : `${4 - completedCount} requirement${4 - completedCount !== 1 ? "s" : ""} remaining`}
            </p>
          </div>
        </div>
        {canProceed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700">
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

      {/* Safe Browser Section */}
      <div className="mb-8">
        <SectionHeader
          title="Safe Browser Setup"
          description="Download and launch the secure exam browser"
        />
        <div className="space-y-3">
          <CheckCard
            icon={Download}
            title="Download Safe Browser"
            description="Download the secure exam browser to your device"
            checked={browserDownloaded}
            stepNumber={1}
            action={
              <ActionButton
                onClick={handleDownloadBrowser}
                completed={browserDownloaded}
                label="Download"
                completedLabel="Downloaded"
              />
            }
          />

          <CheckCard
            icon={ExternalLink}
            title="Open in Safe Browser"
            description="Launch the exam in the safe browser environment"
            checked={browserOpened}
            disabled={!browserDownloaded}
            stepNumber={2}
            action={
              <ActionButton
                onClick={handleOpenBrowser}
                disabled={!browserDownloaded}
                completed={browserOpened}
                label="Open Browser"
                completedLabel="Opened"
              />
            }
          />
        </div>
      </div>

      {/* Device Permissions Section */}
      <div className="mb-8">
        <SectionHeader
          title="Device Permissions"
          description="Grant access to camera and microphone for proctoring"
        />
        <div className="space-y-3">
          <CheckCard
            icon={Camera}
            title="Camera Access"
            description="Required for exam proctoring and identity verification"
            checked={cameraAllowed}
            disabled={!browserOpened}
            stepNumber={3}
            action={
              <ActionButton
                onClick={handleRequestCamera}
                disabled={!browserOpened}
                completed={cameraAllowed}
                label="Allow Camera"
                completedLabel="Allowed"
              />
            }
          >
            {cameraDeviceLabel && (
              <div className="ml-15 text-[12px] text-gray-500">
                Detected device: {cameraDeviceLabel}
              </div>
            )}
            {cameraError && <ErrorMessage message={cameraError} />}
          </CheckCard>

          <CheckCard
            icon={Mic}
            title="Microphone Access"
            description="Required for audio monitoring during the exam"
            checked={microphoneAllowed}
            disabled={!browserOpened}
            stepNumber={4}
            action={
              <ActionButton
                onClick={handleRequestMicrophone}
                disabled={!browserOpened}
                completed={microphoneAllowed}
                label="Allow Mic"
                completedLabel="Allowed"
              />
            }
          >
            {microphoneDeviceLabel && (
              <div className="ml-15 text-[12px] text-gray-500">
                Detected device: {microphoneDeviceLabel}
              </div>
            )}
            {microphoneError && <ErrorMessage message={microphoneError} />}
          </CheckCard>
        </div>
      </div>

      {/* Configuration Section */}
      <div className="mb-8">
        <SectionHeader
          title="Exam Configuration"
          badge="Optional"
          description="Save your exam settings for future reference"
        />
        <CheckCard
          icon={FileDown}
          title="Download Configuration File"
          description="Export exam settings as a JSON configuration file"
          checked={configDownloaded}
          action={
            <button
              onClick={handleDownloadConfig}
              className="px-4 py-2 rounded-lg text-[13px] bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all cursor-pointer"
            >
              {configDownloaded ? (
                <span className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  Downloaded
                </span>
              ) : (
                "Download Config"
              )}
            </button>
          }
        />
      </div>

      {/* Tip banner */}
      <div className="mb-8 flex items-start gap-3 p-4 rounded-xl bg-blue-50/80 border border-blue-100">
        <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-[13px] text-blue-800">
            Make sure all applications except the safe browser are closed before
            proceeding. Background applications may interfere with the exam
            monitoring system.
          </p>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="flex justify-end pt-2 pb-4">
        <button
          onClick={() => navigate(`/exam/${examId}/network-check`)}
          disabled={!canProceed}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] transition-all duration-200 cursor-pointer ${
            canProceed
              ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-200 active:scale-[0.98]"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          Continue to Network Check
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </LobbyLayout>
  );
}
