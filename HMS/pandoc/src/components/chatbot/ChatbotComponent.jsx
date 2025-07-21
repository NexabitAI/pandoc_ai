import React, { useState } from "react";
import Chatbot from "react-chatbot-kit";
import "react-chatbot-kit/build/main.css";

import MessageParser from "./MessageParser";
import ActionProvider from "./ActionProvider";
import config from "./config";
import botIcon from "../../assets/logo.svg";

const ChatbotComponent = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition-all duration-300"
      >
        {isOpen ? "×" : "💬"}
      </button>

      {/* Chatbot UI */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 max-w-full w-[280px] max-h-[650px] z-50 shadow-xl rounded-xl overflow-hidden border border-gray-300 bg-white box-border">

          {/* Chat Header with Bot Icon */}
          <div className="flex items-center justify-between p-3 border-b bg-blue-600 text-white">
            <div className="flex items-center gap-2">
              <img
                src={botIcon}
                alt="Bot"
                className="w-8 h-8 rounded-full border-2 border-white"
              />
              <span className="font-semibold text-sm">PANDOC</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white text-lg font-bold hover:text-red-300"
              aria-label="Close"
            >
              ✖
            </button>
          </div>

          {/* Chatbot Component */}
          <Chatbot
            config={config}
            messageParser={MessageParser}
            actionProvider={ActionProvider}
          />
        </div>
      )}
    </>
  );
};

export default ChatbotComponent;
