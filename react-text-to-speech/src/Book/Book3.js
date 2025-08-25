export const data = [
  {
    Book: {
      id: 1,
      Name: "Pattern Pals: Levels in the Library",
      Characters: [
        {Name:"Narrator", img: require("../Pictures/narrator.png")},
        {Name:"Clara",img: require("../Pictures/book1/Clara_avatar.jpg")},
        {Name:"Zoe",img: require("../Pictures/book1/Zoe_avatar.jpg")},
      ],

      Pages: {
        Cover: {
          img: require("../Pictures/book3/cover.png"),
         
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The Pattern Pals: Levels in the Library",
            }
          ],
        },
        PageOne: {
          img: require("../Pictures/book3/1 Library.jpg"),
          question: "Why do you think Clara asked Zoe to use her inside voice?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“Books!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "squawked Zoe. It was her first library visit.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Shh!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara whispered.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Use your inside voice.”",
            },
          ],
        },

        PageTwo: {
          img: require("../Pictures/book3/2 Library.jpg"),
          question: "How would you arrange your books in stacks?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“What can we do here?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "asked Zoe.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“We can pick out books,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Each of my stacks has one more book than the last. Let’s count them—one book. One, two books. One, two, three books.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The End.",
            },
          ],
        },
        },
       
      },
    },
];

