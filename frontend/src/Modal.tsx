import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Modal({ isOpen, onClose, children, className = '' }: ModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className={`modal-content ${className}`}>
        <button onClick={onClose} className="modal-close-button">
          Close
        </button>
        {children}
      </div>
    </div>
  );
}
