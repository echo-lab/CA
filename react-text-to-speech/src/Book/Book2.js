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
          question: "You will see questions in this box while reading the book. Feel free to use them at your convenience.",
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
          img: require("../Pictures/book2/Page_1.jpg"),
          question: "What is something fun you like to do with your friends?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Welcome to my house!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara beamed.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“This is going to be so much fun!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "sang Zoe. It was their first sleepover.",
            },
          ],
        },
        PageTwo: {
          img: require("../Pictures/book2/Page_2.jpg"),
          question: "Describe the pattern on the sleeping bags.",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Our sleeping bags have the same pattern!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara said.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Yours is yellow, blue, yellow, blue… mine is green, purple, green, purple. Zip, zap, zip, zap!”",
            },
          ],
        },
        PageThree: {
          img: require("../Pictures/book2/Page_3.jpg"),
          question: "Where do you think Clara will hide?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Let’s play hide and seek!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“You count, and I’ll hide,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
          ],
        },
        PageFour: {
          img: require("../Pictures/book2/Page_4.jpg"),
          question: "Which objects in the room do not have a pattern?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“… eighteen, nineteen, twenty!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Ready or not, here I come!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She looked around. No Clara.",
            },
          ],
        },
        PageFive: {
          img: require("../Pictures/book2/Page_5.jpg"),
          question: "What color would the next bunch of flowers be if there was one more?",
          text: [
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe checked under the blanket. No Clara.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She opened the closet. No Clara.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She looked behind some flowers. No Clara there either!",
            },
          ],
        },
        PageSix: {
          img: require("../Pictures/book2/Page_6.jpg"),
          question: "What is the pattern on the curtains?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“How will I find Clara?”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe worried.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“There’s so many places to look…”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She checked in front of the curtains.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "No Clara.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "She peeked behind the curtains...",
            },
          ],
        },
        PageSeven: {
          img: require("../Pictures/book2/Page_7.jpg"),
          question: "Tell me about a time you felt surprised.",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Ta-da!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara cried.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“SQUAWK!”",
            },
          ],
        },
        PageEight: {
          img: require("../Pictures/book2/Page_8.jpg"),
          question: "How do you think Zoe is feeling?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Sorry!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Clara said.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“I didn’t mean to scare you.”"
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I thought—I thought I might not find you,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "stammered Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Your house seems really different from mine.”",
            },
          ],
        },
        PageNine: {
          img: require("../Pictures/book2/Page_9.jpg"),
          question: "Describe the pattern on Clara.",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I miss my house,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe admitted.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Maybe your house is more like mine than you think,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
          ],
        },
        PageTen: {
          img: require("../Pictures/book2/Page_10.jpg"),
          question: "What is another pattern you could make using the shapes on the curtains?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“My curtains seem different,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“They go star, star, heart, star, star, heart.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“It’s the same pattern, though,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“See? Mine go flower, flower, heart, flower, flower, heart. That’s just like star, star, heart!”",
            },
          ],
        },
        PageEleven: {
          img: require("../Pictures/book2/Page_11.jpg"),
          question: "Why does Clara say “zip, zap, zop?”",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“But my blanket doesn’t look like that,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“It has blue, yellow, and red stripes.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Our blankets have the same pattern,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Mine goes purple, pink, green, purple, pink, green. Yours goes blue, yellow, red, blue, yellow, red. See? Zip, zap, zop, zip, zap, zop!” ",
            },
          ],
        },
        PageTwelve: {
          img: require("../Pictures/book2/Page_12.jpg"),
          question: "What are some objects that have the same pattern?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“You’re right,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue:
                "“But your flowers aren’t the same.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“The pattern might be, though,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue:
                "suggested Clara.",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue:
                "“Mine go blue, orange, blue, orange. How do yours go?”",
            },
          ],
        },
        PageThirteen: {
          img: require("../Pictures/book2/Page_13.jpg"),
          question: "How is “blue, orange, blue, orange” and “tall, short, tall, short” the same pattern?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“My flowers go tall, short, tall, short. It’s the same pattern as yours!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe realized.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Zip, zap, zip, zap!”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“You got it!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
          ],
        },
        PageFourteen: {
          img: require("../Pictures/book2/Page_14.jpg"),
          question: "Which items are different colors but have the same pattern?",
          text: [
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“Your house doesn’t seem so different anymore.”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "Zoe smiled.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“I feel better.”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Great!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Clara.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“One problem… I forgot my pillow!”",
            },
          ],
        },
        PageFifteen: {
          img: require("../Pictures/book2/Page_15.jpg"),
          question: "What is a pattern on the pillow Clara gives Zoe?",
          text: [
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Here’s one,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "offered Clara.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“It doesn’t match mine at home,”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "said Zoe.",
            },
            {
              Reading: false,
              Character: "Zoe",
              Dialogue: "“But it’s okay if some things are different! Zip, zap, zoodely, zoop!”",
            },
            {
              Reading: false,
              Character: "Clara",
              Dialogue: "“Zip, zap, zoodely, zoop!”",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "The two friends laughed together.",
            },
            {
              Reading: false,
              Character: "Narrator",
              Dialogue: "The End.",
            },
          ],
        },        
       
      },
    },
  },
];

