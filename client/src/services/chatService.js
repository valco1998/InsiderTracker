export function getMockConversations() {
  return [
    {
      id: "global-chat",
      name: "Global Chat",
      type: "global",
      lastMessage: "New Karambit deal just dropped",
      unreadCount: 3,
      avatar: "🌍",
      members: [
        { id: "u1", name: "Idan", status: "online" },
        { id: "u2", name: "Daniel", status: "online" },
        { id: "u3", name: "Noa", status: "away" },
      ],
    },
    {
      id: "group-friends",
      name: "Friends Group",
      type: "group",
      lastMessage: "Who is watching M9 prices?",
      unreadCount: 1,
      avatar: "👥",
      members: [
        { id: "u1", name: "Idan", status: "online" },
        { id: "u2", name: "Daniel", status: "online" },
        { id: "u3", name: "Noa", status: "away" },
        { id: "u4", name: "Amit", status: "offline" },
      ],
    },
    {
      id: "private-daniel",
      name: "Daniel",
      type: "private",
      lastMessage: "Send me the item link",
      unreadCount: 0,
      avatar: "D",
      members: [
        { id: "u1", name: "Idan", status: "online" },
        { id: "u2", name: "Daniel", status: "online" },
      ],
    },
    {
      id: "group-knives",
      name: "Knife Hunters",
      type: "group",
      lastMessage: "Factory New prices are climbing",
      unreadCount: 0,
      avatar: "🔪",
      members: [
        { id: "u1", name: "Idan", status: "online" },
        { id: "u5", name: "Roi", status: "online" },
        { id: "u6", name: "Lior", status: "offline" },
      ],
    },
  ];
}

export function getMockMessages() {
  return {
    "global-chat": [
      {
        id: "m1",
        senderId: "u2",
        senderName: "Daniel",
        text: "Did anyone see the latest Karambit listing?",
        createdAt: "18:41",
        mine: false,
      },
      {
        id: "m2",
        senderId: "u1",
        senderName: "Idan",
        text: "Yes, I want the chat to feel like WhatsApp but more premium.",
        createdAt: "18:42",
        mine: true,
      },
      {
        id: "m3",
        senderId: "u3",
        senderName: "Noa",
        text: "Then keep conversations left, chat in the center, members on the right.",
        createdAt: "18:43",
        mine: false,
      },
    ],
    "group-friends": [
      {
        id: "m4",
        senderId: "u2",
        senderName: "Daniel",
        text: "Who is watching M9 prices?",
        createdAt: "19:01",
        mine: false,
      },
      {
        id: "m5",
        senderId: "u1",
        senderName: "Idan",
        text: "Me. I want private chat, group chat and global all together.",
        createdAt: "19:02",
        mine: true,
      },
      {
        id: "m6",
        senderId: "u3",
        senderName: "Noa",
        text: "Start from the client side first, it will be easier.",
        createdAt: "19:03",
        mine: false,
      },
    ],
    "private-daniel": [
      {
        id: "m7",
        senderId: "u2",
        senderName: "Daniel",
        text: "Send me the item link",
        createdAt: "19:10",
        mine: false,
      },
      {
        id: "m8",
        senderId: "u1",
        senderName: "Idan",
        text: "I will send it after I finish the chat UI.",
        createdAt: "19:11",
        mine: true,
      },
    ],
    "group-knives": [
      {
        id: "m9",
        senderId: "u5",
        senderName: "Roi",
        text: "Factory New prices are climbing",
        createdAt: "20:01",
        mine: false,
      },
      {
        id: "m10",
        senderId: "u1",
        senderName: "Idan",
        text: "Good. I want alerts and chat to work together later.",
        createdAt: "20:02",
        mine: true,
      },
    ],
  };
}