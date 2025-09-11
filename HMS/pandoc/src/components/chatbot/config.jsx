import { createChatBotMessage } from "react-chatbot-kit";
import ActionProvider from "./ActionProvider";
import DoctorList from "./widgets/DoctorList";

const config = {
  initialMessages: [
    createChatBotMessage("👋 I’m Pandoc Health Assistant. Tell me your symptoms or what you need help with.")
  ],
  state: { doctors: [], selectedDoctor: null },
  botName: "PANDOC",
  markdown: true,
  customStyles: {
    botMessageBox: { backgroundColor: "#2563eb" },
    chatButton: { backgroundColor: "#2563eb" },
  },
  widgets: [
    { widgetName: "doctorList", widgetFunc: (props) => <DoctorList {...props} /> },
  ],
  actionProvider: (props) =>
    new ActionProvider(props.createChatBotMessage, props.setState, props.state),
};

export default config;
