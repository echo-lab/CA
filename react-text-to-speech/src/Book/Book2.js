export const data = [
  {
    Book: {
      id: 1,
      Name: "Pattern Pals: Sleepover Similarities",
      Characters: [
        {Name:"Narrator", img: require("../Pictures/narrator.png")},
        {Name:"Clara",img: require("../Pictures/book1/Clara_avatar.jpg")},
        {Name:"Zoe",img: require("../Pictures/book1/Zoe_avatar.jpg")},
      ],

      Pages: {
        Cover: {
          img: require("../Pictures/book2/cover.png"),
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "The Pattern Pals: Sleepover Similarities",
            }
          ],
        },
        PageOne: {
          img: require("../Pictures/book2/1 Sleepover.jpg"),
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Welcome to my house!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara beamed.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“This is going to be so much fun!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "sang Zoe. \nIt was their first sleepover.",
            },
          ],
        },

        PageTwo: {
          img: require("../Pictures/book2/2 Sleepover.jpg"),
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Our sleeping bags have the same pattern!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "Clara said.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Yours is yellow, blue, yellow, blue… mine is green, purple, green, purple. Zip, zap, zip, zap!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "The End",
            },
          ],
        },
       
      },
    },
  },
];

