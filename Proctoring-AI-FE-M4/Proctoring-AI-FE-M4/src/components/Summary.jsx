import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Doughnut } from 'react-chartjs-2';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import { authService } from '../services/authService';
import { examService } from '../services/examService';
import { formatServerDateTime } from '../utils/timeUtils';
import '../styles/summary.css';

const Summary = () => {
    const summaryRef = useRef(null);
    const [summary, setSummary] = useState(null);
    const [, setUserImage] = useState(null);
    const [score, setScore] = useState(0);
    const [examResult, setExamResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [examViolation, setExamViolation] = useState(null);
    const [appealSubmitting, setAppealSubmitting] = useState(false);
    const navigate = useNavigate();
    const examId = localStorage.getItem('examId');
    const examRoute = examId ? `/exam/${examId}` : '/exam';
    const warningItems = Array.isArray(summary?.warnings)
        ? summary.warnings.map((warning) => (
            typeof warning === 'string'
                ? warning
                : warning?.message || warning?.type || JSON.stringify(warning)
        ))
        : [];

    const violationLabel = (warning) => {
        if (typeof warning === 'string') return warning;
        const rawLabel = warning?.message || warning?.type || String(warning);
        const normalized = String(rawLabel || '').trim().toLowerCase().replace(/-/g, '_');
        const labels = {
            face_outside_box: 'Face Outside Guide Box',
            face_partially_visible: 'Partial Face Visible',
            face_too_close: 'Face Too Close To Camera',
            face_too_far: 'Face Too Far From Camera',
        };
        return labels[normalized] || rawLabel;
    };

    const formatTerminationReason = (type) => {
        const normalized = String(type || '').trim().toLowerCase();
        const labels = {
            'tab-switch': 'Excessive Tab Switching',
            'copy-paste': 'Excessive Copy-Paste Attempts',
            'identity-mismatch': 'Identity Mismatch',
            'multiple-people': 'Multiple People Detected',
            'face-not-visible': 'Face Not Visible (Grace Exceeded)',
            'face-outside-box': 'Continuous Face Outside Guide Box',
            'repeated-face-outside-box': 'Repeated Face Outside Guide Box Breaches',
            'phone-detected': 'Prohibited Device Detected',
            'prohibited-object': 'Prohibited Material Detected',
            'screen-share-stopped': 'Screen Sharing Stopped',
            'audio-anomaly': 'Third-Party Communication / Audio Anomaly',
            'tampering-detected': 'System Tampering Detected',
        };

        return labels[normalized] || type || 'Policy violation';
    };

    useEffect(() => {
        const fetchSummary = async () => {
            try {
                const examScore = localStorage.getItem('examScore');
                const examResultData = localStorage.getItem('examResult');
                const userId = localStorage.getItem('userId');

                if (!userId) {
                    throw new Error('Missing exam data');
                }

                setScore(parseFloat(examScore) || 0);

                // Parse exam result if available
                if (examResultData) {
                    setExamResult(JSON.parse(examResultData));
                }

                const summaryData = await examService.getExamSummary(userId);

                const violationData = localStorage.getItem('examViolation');
                if (violationData) {
                    setExamViolation(JSON.parse(violationData));
                }

                setSummary({
                    overall_compliance: summaryData.overall_compliance || 0,
                    total_duration: summaryData.total_duration || 0,
                    face_detection_rate: summaryData.face_detection_rate || 0,
                    suspicious_activities: summaryData.suspicious_activities || {},
                    warnings: summaryData.warnings || [],
                    user: summaryData.user || {}
                });

                if (summaryData.user?.image) {
                    const img = new Image();
                    img.src = `data:image/jpeg;base64,${summaryData.user.image}`;
                    await new Promise((resolve) => {
                        img.onload = resolve;
                    });
                    setUserImage(img);
                }

            } catch (error) {
                console.error('Error loading summary:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to load exam summary',
                    background: '#2a2a2a',
                    color: '#fff'
                });
                navigate(examRoute);
            } finally {
                setLoading(false);
            }
        };

        fetchSummary();
    }, [examRoute, navigate]);

const renderSummaryChart = () => {
    if (!summary) return null;

    const data = {
        labels: ['Compliant', 'Non-Compliant'],
        datasets: [{
            data: [
                summary.overall_compliance || 0,
                100 - (summary.overall_compliance || 0)
            ],
            backgroundColor: ['#10b981', '#ef4444'],
            borderColor: ['#059669', '#dc2626'],
            borderWidth: 2,
            hoverBorderWidth: 3,
        }]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    color: '#fff',
                    padding: 24,
                    font: { size: 15, weight: '500' }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: 1,
                padding: 12,
                displayColors: false,
                boxWidth: 12,
                boxHeight: 12,
                cornerRadius: 4,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed !== null) {
                            label += new Intl.NumberFormat('en-US', { 
                                style: 'percent',
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1
                            }).format(context.parsed / 100);
                        }
                        return label;
                    }
                }
            }
        },
        cutout: '65%',
        radius: '70%',
        animation: {
            animateScale: true,
            animateRotate: true
        }
    };

    return (
        <div style={{ width: '100%', height: '100%', maxWidth: '320px', maxHeight: '320px', margin: '0 auto' }}>
            <Doughnut data={data} options={options} />
        </div>
    );
};

const renderViolations = () => {
    const violations = JSON.parse(localStorage.getItem('examViolations') || '{}');
    if (!Object.keys(violations).length) return null;
    const warningList = Array.isArray(violations.warnings) ? violations.warnings : [];

    return (
        <div className="section-card violations">
            <h3>Exam Violations</h3>
            <div className="violation-stats">
                <div className="compliance-score">
                    <span>Compliance Score</span>
                    <strong>{violations.complianceScore}%</strong>
                </div>
                <div className="violation-list">
                    {warningList.map((warning, index) => (
                        <div key={index} className="violation-item">
                            <span className="violation-icon">⚠️</span>
                            <span>{violationLabel(warning)}</span>
                        </div>
                    ))}
                </div>
                {violations.type && (
                    <div className="termination-reason">
                        <span>Exam Terminated Due To:</span>
                        <strong>
                            {formatTerminationReason(violations.type)}
                            {violations.attempts > 1 && ` (${violations.attempts} attempts)`}
                        </strong>
                    </div>
                )}
            </div>
        </div>
    );
};

    const handleLogout = async () => {
        try {
            const userId = localStorage.getItem('userId');
            if (userId) {
                await examService.clearLogs(userId);
            }

            authService.logout();
            navigate('/login', { replace: true });
        } catch (error) {
            console.warn('Logout error:', error);
            authService.logout();
            navigate('/login', { replace: true });
        }
    };

    const handleDownloadPDF = async () => {
        try {
            Swal.fire({
                title: 'Generating PDF',
                html: 'Please wait...',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.width;
            let yPosition = 15;
            const lineHeight = 7;

            // Title and header info
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(20);
            pdf.setTextColor(0, 0, 0);
            pdf.text('Exam Report', pageWidth / 2, yPosition, { align: 'center' });

            yPosition += lineHeight * 2;
            pdf.setFontSize(12);
            pdf.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, { align: 'center' });

            // User Info
            yPosition += lineHeight * 2;
            if (summary.user?.email) {
                pdf.text(`Candidate: ${summary.user.email}`, pageWidth / 2, yPosition, { align: 'center' });
            }

            // Add user image if available
            if (summary.user?.image) {
                yPosition += lineHeight * 2;
                const imgData = `data:image/jpeg;base64,${summary.user.image}`;
                const imgProps = pdf.getImageProperties(imgData);
                const imgWidth = 50;
                const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                pdf.addImage(imgData, 'JPEG', (pageWidth - imgWidth) / 2, yPosition, imgWidth, imgHeight);
                yPosition += imgHeight + lineHeight;
            }

            // Score and Compliance
            yPosition += lineHeight * 2;
            pdf.setFontSize(14);
            pdf.text('Exam Performance', pageWidth / 2, yPosition, { align: 'center' });

            yPosition += lineHeight;
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'normal');
            pdf.text(
                `Score: ${examResult ? examResult.score : score}/${examResult ? examResult.total_marks : '?'}`,
                20,
                yPosition
            );
            pdf.text(`Compliance Rate: ${summary.overall_compliance.toFixed(1)}%`, 20, yPosition + lineHeight);
            pdf.text(`Duration: ${summary.total_duration.toFixed(1)} minutes`, 20, yPosition + lineHeight * 2);
            pdf.text(`Face Detection Rate: ${summary.face_detection_rate.toFixed(1)}%`, 20, yPosition + lineHeight * 3);

            // Violations Section
            yPosition += lineHeight * 5;
            pdf.setFont('helvetica', 'bold');
            pdf.text('Major Violations', 20, yPosition);

            yPosition += lineHeight;
            pdf.setFont('helvetica', 'normal');
            if (Object.keys(summary.suspicious_activities).length > 0) {
                Object.entries(summary.suspicious_activities).forEach(([key, value]) => {
                    const violation = formatViolationDisplay(key, value);
                    yPosition += lineHeight;
                    const violationText = `${key.replace(/_/g, ' ')} - Count: ${violation.count}`;
                    pdf.text(violationText, 25, yPosition);
                    yPosition += lineHeight - 2;
                    pdf.setFontSize(10);
                    pdf.text(`First occurred at: ${violation.timestamp}`, 30, yPosition);
                    pdf.setFontSize(12);
                });
            } else {
                yPosition += lineHeight;
                pdf.text('No major violations detected', 25, yPosition);
            }

            // Add warnings if available
            if (summary.warnings?.length > 0) {
                yPosition += lineHeight * 2;
                pdf.setFont('helvetica', 'bold');
                pdf.text('Warnings', 20, yPosition);
                pdf.setFont('helvetica', 'normal');
                summary.warnings.forEach(warning => {
                    yPosition += lineHeight;
                    pdf.text(`- ${violationLabel(warning)}`, 25, yPosition);
                });
            }

            // Footer
            pdf.setFontSize(10);
            pdf.setTextColor(128, 128, 128);
            const footer = 'AI Proctoring System - Exam Report';
            pdf.text(footer, pageWidth / 2, pdf.internal.pageSize.height - 10, { align: 'center' });

            // Save the PDF
            pdf.save(`exam_summary_${localStorage.getItem('userId')}.pdf`);

            await Swal.fire({
                icon: 'success',
                title: 'Download Complete',
                text: 'Your exam summary has been downloaded successfully.',
                background: '#2a2a2a',
                color: '#fff'
            });
        } catch (error) {
            console.error('PDF generation error:', error);
            Swal.fire({
                icon: 'error',
                title: 'Download Failed',
                text: 'Failed to generate PDF. Please try again.',
                background: '#2a2a2a',
                color: '#fff'
            });
        }
    };

    const handleRequestManualReview = async () => {
        const userId = localStorage.getItem('userId');
        if (!userId || appealSubmitting) return;

        setAppealSubmitting(true);
        try {
            await examService.logViolation(
                'appeal_request',
                'Student requested post-exam manual review',
                {
                    requested_at: new Date().toISOString(),
                    exam_id: examId || null,
                    termination_type: examViolation?.type || null,
                    warning_count: warningItems.length,
                }
            );

            await Swal.fire({
                icon: 'success',
                title: 'Review Request Submitted',
                text: 'Your appeal has been logged for admin review.',
                background: '#2a2a2a',
                color: '#fff'
            });
        } catch (error) {
            console.error('Failed to submit appeal request:', error);
            await Swal.fire({
                icon: 'error',
                title: 'Request Failed',
                text: 'Unable to submit appeal right now. Please try again later.',
                background: '#2a2a2a',
                color: '#fff'
            });
        } finally {
            setAppealSubmitting(false);
        }
    };

    const formatViolationDisplay = (key, value) => {
        return {
            count: value.count,
            timestamp: formatServerDateTime(
                value.first_occurrence,
                undefined,
                { dateStyle: 'medium', timeStyle: 'medium' }
            )
        };
    };

const renderUserInfo = () => {
    if (!summary?.user) return null;
    return (
        <div className="user-info-section">
            <div className="user-image">
                {summary.user.image ? (
                    <img 
                        src={`data:image/jpeg;base64,${summary.user.image}`}
                        alt="User"
                    />
                ) : (
                    <div className="user-placeholder">
                        {summary.user.name ? summary.user.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                )}
            </div>
            <div className="user-details">
                <span className="user-email">{summary.user.email}</span>
                {summary.user.name && (
                    <span className="user-name">{summary.user.name}</span>
                )}
            </div>
        </div>
    );
};

    if (loading) {
        return (
            <div className="summary-loading">
                <div className="loading-spinner"></div>
                <h3>Loading Exam Results...</h3>
            </div>
        );
    }

    if (!summary) return null;

    return (
        <div className="summary-container">
            <div ref={summaryRef} className="summary-shell">
                {renderUserInfo()}
                <div className="summary-header">
                    <h1>Exam Results</h1>
                    {examResult && (
                        <div className={`status-badge ${examResult.status === 'passed' ? 'passed' : 'failed'}`}>
                            {examResult.status === 'passed' ? 'Passed' : 'Failed'}
                        </div>
                    )}
                    <div className="header-stats">
                        <div className="stat-card primary">
                            <h3>Score</h3>
                            <div className="score-display">
                                <strong>{examResult ? examResult.score : score}</strong>
                                <span>/{examResult ? examResult.total_marks : '?'}</span>
                            </div>
                            <p>Marks Obtained</p>
                        </div>
                        <div className="stat-card secondary">
                            <h3>Percentage</h3>
                            <div className="score-display">
                                <strong>{examResult ? examResult.percentage : 0}%</strong>
                            </div>
                            <p>Overall Score</p>
                        </div>
                        <div className="stat-card tertiary">
                            <h3>Questions</h3>
                            <div className="score-display">
                                <strong>{examResult ? examResult.correct : 0}</strong>
                                <span>/{examResult ? examResult.total_questions : 0}</span>
                            </div>
                            <p>Correct Answers</p>
                        </div>
                    </div>
                    {examResult && (
                        <div className="question-breakdown">
                            <div className="breakdown-item">
                                <span>Total Questions:</span>
                                <strong>{examResult.total_questions}</strong>
                            </div>
                            <div className="breakdown-item">
                                <span>Attempted:</span>
                                <strong>{examResult.attempted}</strong>
                            </div>
                            <div className="breakdown-item correct">
                                <span>Correct:</span>
                                <strong>{examResult.correct}</strong>
                            </div>
                            <div className="breakdown-item wrong">
                                <span>Wrong:</span>
                                <strong>{examResult.wrong}</strong>
                            </div>
                        </div>
                    )}
                </div>

                <div className="summary-grid">
                    <div className="chart-section">
                        <div className="section-card">
                            <h3>Proctoring Analysis</h3>
                            {renderSummaryChart()}
                        </div>
                    </div>

                    <div className="metrics-section">
                        <div className="section-card">
                            <h3>Exam Metrics</h3>
                            <div className="metrics-grid">
                                <div className="metric-item">
                                    <span>Duration</span>
                                    <strong>{(summary.total_duration || 0).toFixed(1)} min</strong>
                                </div>
                                <div className="metric-item">
                                    <span>Face Detection</span>
                                    <strong>{(summary.face_detection_rate || 0).toFixed(1)}%</strong>
                                </div>
                                <div className="metric-item">
                                    <span>Warnings</span>
                                    <strong>{warningItems.length}</strong>
                                </div>
                                {examViolation && examViolation.type === 'copy-paste' && (
                                    <div className="metric-item violation">
                                        <span>Violation</span>
                                        <strong>Copy-Paste Detected</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {summary.suspicious_activities && Object.keys(summary.suspicious_activities).length > 0 && (
                        <div className="activity-section">
                            <div className="section-card">
                                <h3>Major Violations</h3>
                                <div className="activity-list">
                                    {Object.entries(summary.suspicious_activities).map(([key, value]) => {
                                        const violation = formatViolationDisplay(key, value);
                                        return (
                                            <div key={key} className="activity-item high-severity">
                                                <div className="activity-details">
                                                    <span className="activity-name">
                                                        {key.replace(/_/g, ' ')}
                                                    </span>
                                                    <div className="activity-info">
                                                        <strong className="activity-count">
                                                            count: {violation.count}
                                                        </strong>
                                                        <span className="violation-timestamp">
                                                            at {violation.timestamp}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {renderViolations()}

                    {warningItems.length > 0 && (
                        <div className="section-card warnings-section">
                            <h3>Warnings Timeline</h3>
                            <div className="warnings-list">
                                {warningItems.map((warning, index) => (
                                    <div key={`${warning}-${index}`} className="warning-item">
                                        <span className="warning-index">{String(index + 1).padStart(2, '0')}</span>
                                        <p>{warning}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="actions-section">
                        <button onClick={handleLogout} className="action-button primary">
                            Complete Exam & Logout
                        </button>
                        <button onClick={handleDownloadPDF} className="action-button secondary">
                            Download Summary
                        </button>
                        <button
                            onClick={handleRequestManualReview}
                            className="action-button secondary"
                            disabled={appealSubmitting}
                        >
                            {appealSubmitting ? 'Submitting Review Request...' : 'Request Manual Review'}
                        </button>
                        <button onClick={() => navigate(examRoute)} className="action-button secondary">
                            Back to Exam
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Summary;
